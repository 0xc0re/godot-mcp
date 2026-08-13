/**
 * Integration tests — no godot.js or fs mocks.
 *
 * Exercises the real validatePath implementation and a real .tscn
 * round-trip: fixture file → tscn-parser → tscn-writer → tscn-parser.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validatePath } from '../src/godot.js';
import { parseScene } from '../src/parsers/tscn-parser.js';
import { addNodeToScene } from '../src/parsers/tscn-writer.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('validatePath (real implementation)', () => {
  it('accepts ordinary absolute and relative paths', () => {
    expect(validatePath('/home/user/projects/my-game')).toBe(true);
    expect(validatePath('scenes/main.tscn')).toBe(true);
    expect(validatePath('res://scripts/player.gd')).toBe(true);
    expect(validatePath('assets/sprites/hero 2.png')).toBe(true);
  });

  it('rejects empty and non-string input', () => {
    expect(validatePath('')).toBe(false);
    expect(validatePath(undefined as unknown as string)).toBe(false);
    expect(validatePath(null as unknown as string)).toBe(false);
    expect(validatePath(42 as unknown as string)).toBe(false);
  });

  it('rejects ".." traversal anywhere in the path', () => {
    expect(validatePath('../outside')).toBe(false);
    expect(validatePath('scenes/../../etc/passwd')).toBe(false);
    expect(validatePath('/proj/..')).toBe(false);
  });

  it('rejects null bytes', () => {
    expect(validatePath('scenes/\0evil.tscn')).toBe(false);
  });
});

describe('.tscn round-trip: parse → add node → re-parse (real fixture)', () => {
  const original = readFileSync(join(FIXTURES, 'sample.tscn'), 'utf-8');

  it('parses the fixture into the expected structure', () => {
    const scene = parseScene(original);

    expect(scene.format).toBe(3);
    expect(scene.uid).toBe('uid://cecaux1sm7mo0');
    expect(scene.extResources).toHaveLength(2);
    expect(scene.extResources[0]).toMatchObject({
      type: 'Script',
      path: 'res://player.gd',
      id: '1_abc',
    });
    expect(scene.subResources).toHaveLength(1);
    expect(scene.nodes.map((n) => n.name)).toEqual([
      'GameWorld',
      'Player',
      'CollisionShape3D',
      'Camera3D',
    ]);
    expect(scene.connections).toEqual([
      { signal: 'body_entered', from: 'Player', to: '.', method: '_on_body_entered' },
    ]);
  });

  it('adds a node and re-parses with all original content preserved', () => {
    const updated = addNodeToScene(original, {
      parentNodePath: 'root/Player',
      nodeType: 'Sprite2D',
      nodeName: 'HeroSprite',
      properties: { visible: false, z_index: 4 },
    });

    const scene = parseScene(updated);

    // New node is present, parented correctly, with its properties
    const added = scene.nodes.find((n) => n.name === 'HeroSprite');
    expect(added).toBeDefined();
    expect(added!.type).toBe('Sprite2D');
    expect(added!.parent).toBe('Player');
    expect(added!.properties.visible).toBe('false');
    expect(added!.properties.z_index).toBe('4');

    // Every original node survives with type and properties intact
    const originalScene = parseScene(original);
    for (const node of originalScene.nodes) {
      const match = scene.nodes.find((n) => n.name === node.name);
      expect(match).toBeDefined();
      expect(match!.type).toBe(node.type);
      expect(match!.parent).toBe(node.parent);
      expect(match!.properties).toEqual(node.properties);
    }

    // Resources and connections survive untouched
    expect(scene.extResources).toEqual(originalScene.extResources);
    expect(scene.subResources).toEqual(originalScene.subResources);
    expect(scene.connections).toEqual(originalScene.connections);

    // .tscn ordering invariant: the new [node] is inserted BEFORE [connection]
    expect(updated.indexOf('[node name="HeroSprite"')).toBeLessThan(
      updated.indexOf('[connection '),
    );
  });

  it('adds a root child when parentNodePath is "root"', () => {
    const updated = addNodeToScene(original, {
      parentNodePath: 'root',
      nodeType: 'CanvasLayer',
      nodeName: 'UI',
    });

    const scene = parseScene(updated);
    const added = scene.nodes.find((n) => n.name === 'UI');
    expect(added).toBeDefined();
    expect(added!.parent).toBe('.');
  });

  it('round-trips a scene with groups without losing them', () => {
    const withGroups = readFileSync(join(FIXTURES, 'sample-with-groups.tscn'), 'utf-8');
    const before = parseScene(withGroups);

    const updated = addNodeToScene(withGroups, {
      nodeType: 'Node',
      nodeName: 'Extra',
    });
    const after = parseScene(updated);

    for (const node of before.nodes) {
      const match = after.nodes.find((n) => n.name === node.name);
      expect(match).toBeDefined();
      expect(match!.groups).toEqual(node.groups);
    }
    expect(after.nodes.find((n) => n.name === 'Extra')).toBeDefined();
  });

  it('rejects invalid node names instead of corrupting the scene', () => {
    expect(() =>
      addNodeToScene(original, {
        nodeType: 'Node',
        nodeName: 'Bad" parent="/evil',
      }),
    ).toThrow(/Invalid node name/);
  });
});
