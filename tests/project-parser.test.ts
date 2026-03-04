/**
 * Tests for project.godot INI-format parser.
 *
 * Verifies parsing of sections, key=value pairs, multi-line values,
 * comments, and config_version extraction.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseProjectSettings } from '../src/parsers/project-parser.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('parseProjectSettings', () => {
  it('returns empty sections with configVersion 0 for empty content', () => {
    const result = parseProjectSettings('');
    expect(result.sections).toEqual({});
    expect(result.configVersion).toBe(0);
  });

  it('parses [application] section with config/name and config/features keys', () => {
    const content = `[application]

config/name="My Game"
config/features=PackedStringArray("4.3", "Forward Plus")
`;
    const result = parseProjectSettings(content);
    expect(result.sections['application']).toBeDefined();
    expect(result.sections['application']['config/name']).toBe('"My Game"');
    expect(result.sections['application']['config/features']).toBe(
      'PackedStringArray("4.3", "Forward Plus")',
    );
  });

  it('parses [autoload] section with key=value pairs', () => {
    const content = `[autoload]

GameManager="*res://scripts/game_manager.gd"
AudioSystem="*res://scripts/audio_system.gd"
`;
    const result = parseProjectSettings(content);
    expect(result.sections['autoload']).toBeDefined();
    expect(result.sections['autoload']['GameManager']).toBe(
      '"*res://scripts/game_manager.gd"',
    );
    expect(result.sections['autoload']['AudioSystem']).toBe(
      '"*res://scripts/audio_system.gd"',
    );
  });

  it('parses [input] section with multi-line Object(InputEventKey,...) values', () => {
    const content = `[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":65,"key_label":0,"unicode":97,"location":0,"echo":false,"script":null)
]
}
`;
    const result = parseProjectSettings(content);
    expect(result.sections['input']).toBeDefined();
    const moveLeft = result.sections['input']['move_left'];
    expect(moveLeft).toBeDefined();
    expect(moveLeft).toContain('"deadzone": 0.5');
    expect(moveLeft).toContain('InputEventKey');
  });

  it('parses [rendering] section with simple key=value pairs', () => {
    const content = `[rendering]

renderer/rendering_method="forward_plus"
textures/vram_compression/import_etc2_astc=true
`;
    const result = parseProjectSettings(content);
    expect(result.sections['rendering']).toBeDefined();
    expect(result.sections['rendering']['renderer/rendering_method']).toBe(
      '"forward_plus"',
    );
    expect(result.sections['rendering']['textures/vram_compression/import_etc2_astc']).toBe(
      'true',
    );
  });

  it('handles comments (lines starting with ;) by skipping them', () => {
    const content = `; This is a comment
; Another comment

[application]

; Inline comment before key
config/name="Test"
`;
    const result = parseProjectSettings(content);
    expect(result.sections['application']).toBeDefined();
    expect(result.sections['application']['config/name']).toBe('"Test"');
    // Comments should not appear as keys or values
    expect(Object.keys(result.sections['application'])).toHaveLength(1);
  });

  it('handles root-level keys before any section header (config_version extracted separately)', () => {
    const content = `config_version=5

[application]

config/name="Test"
`;
    const result = parseProjectSettings(content);
    expect(result.configVersion).toBe(5);
    expect(result.sections['application']).toBeDefined();
  });

  it('parses realistic sample.project.godot fixture with multiple sections', () => {
    const content = readFileSync(
      join(FIXTURES, 'sample.project.godot'),
      'utf-8',
    );
    const result = parseProjectSettings(content);

    // config_version at root level
    expect(result.configVersion).toBe(5);

    // application section
    expect(result.sections['application']).toBeDefined();
    expect(result.sections['application']['config/name']).toBe('"My Awesome Game"');
    expect(result.sections['application']['run/main_scene']).toBe(
      '"res://scenes/main.tscn"',
    );

    // autoload section
    expect(result.sections['autoload']).toBeDefined();
    expect(Object.keys(result.sections['autoload'])).toHaveLength(3);
    expect(result.sections['autoload']['GameManager']).toBe(
      '"*res://scripts/game_manager.gd"',
    );

    // display section
    expect(result.sections['display']).toBeDefined();
    expect(result.sections['display']['window/size/viewport_width']).toBe('1920');

    // input section with multi-line values
    expect(result.sections['input']).toBeDefined();
    expect(result.sections['input']['move_left']).toContain('InputEventKey');
    expect(result.sections['input']['jump']).toContain('InputEventKey');

    // rendering section
    expect(result.sections['rendering']).toBeDefined();
    expect(result.sections['rendering']['renderer/rendering_method']).toBe(
      '"forward_plus"',
    );
  });
});
