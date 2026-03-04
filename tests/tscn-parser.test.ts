import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseScene, parseResource } from '../src/parsers/tscn-parser.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------------------
// parseScene
// ---------------------------------------------------------------------------
describe('parseScene', () => {
  it('parses the sample.tscn fixture into a complete ParsedScene', () => {
    const content = readFileSync(join(FIXTURES, 'sample.tscn'), 'utf-8');
    const scene = parseScene(content);

    // Header
    expect(scene.format).toBe(3);
    expect(scene.uid).toBe('uid://cecaux1sm7mo0');
    expect(scene.loadSteps).toBe(4);

    // Ext resources
    expect(scene.extResources).toHaveLength(2);
    expect(scene.extResources[0]).toEqual({
      type: 'Script',
      uid: 'uid://abc123',
      path: 'res://player.gd',
      id: '1_abc',
    });
    expect(scene.extResources[1]).toEqual({
      type: 'PackedScene',
      uid: 'uid://def456',
      path: 'res://enemy.tscn',
      id: '2_def',
    });

    // Sub resources
    expect(scene.subResources).toHaveLength(1);
    expect(scene.subResources[0].type).toBe('StandardMaterial3D');
    expect(scene.subResources[0].id).toBe('StandardMaterial3D_xyz');
    expect(scene.subResources[0].properties['albedo_color']).toBe(
      'Color(1, 0.64, 0.31, 1)',
    );
    expect(scene.subResources[0].properties['metallic']).toBe('0.5');

    // Nodes
    expect(scene.nodes).toHaveLength(4);

    // Root node — no parent
    expect(scene.nodes[0].name).toBe('GameWorld');
    expect(scene.nodes[0].type).toBe('Node3D');
    expect(scene.nodes[0].parent).toBeUndefined();

    // Direct child of root
    expect(scene.nodes[1].name).toBe('Player');
    expect(scene.nodes[1].type).toBe('CharacterBody3D');
    expect(scene.nodes[1].parent).toBe('.');
    expect(scene.nodes[1].properties['transform']).toBe(
      'Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0)',
    );
    expect(scene.nodes[1].properties['script']).toBe('ExtResource("1_abc")');

    // Nested child
    expect(scene.nodes[2].name).toBe('CollisionShape3D');
    expect(scene.nodes[2].parent).toBe('Player');

    // Deep nested child
    expect(scene.nodes[3].name).toBe('Camera3D');
    expect(scene.nodes[3].parent).toBe('Player/CollisionShape3D');
    expect(scene.nodes[3].properties['fov']).toBe('75.0');

    // Connections
    expect(scene.connections).toHaveLength(1);
    expect(scene.connections[0]).toEqual({
      signal: 'body_entered',
      from: 'Player',
      to: '.',
      method: '_on_body_entered',
    });
  });

  it('parses a minimal scene with just header and root node', () => {
    const content = `[gd_scene format=3]

[node name="Root" type="Node2D"]
`;
    const scene = parseScene(content);

    expect(scene.format).toBe(3);
    expect(scene.uid).toBeUndefined();
    expect(scene.loadSteps).toBeUndefined();
    expect(scene.extResources).toEqual([]);
    expect(scene.subResources).toEqual([]);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]).toEqual({
      name: 'Root',
      type: 'Node2D',
      properties: {},
    });
    expect(scene.connections).toEqual([]);
  });

  it('returns defaults for empty string', () => {
    const scene = parseScene('');

    expect(scene.format).toBe(0);
    expect(scene.uid).toBeUndefined();
    expect(scene.loadSteps).toBeUndefined();
    expect(scene.extResources).toEqual([]);
    expect(scene.subResources).toEqual([]);
    expect(scene.nodes).toEqual([]);
    expect(scene.connections).toEqual([]);
  });

  it('parses node properties correctly', () => {
    const content = `[gd_scene format=3]

[node name="Sprite" type="Sprite2D"]
position = Vector2(100, 200)
scale = Vector2(2, 2)
visible = true
`;
    const scene = parseScene(content);

    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0].properties['position']).toBe('Vector2(100, 200)');
    expect(scene.nodes[0].properties['scale']).toBe('Vector2(2, 2)');
    expect(scene.nodes[0].properties['visible']).toBe('true');
  });

  it('parses connections with optional flags', () => {
    const content = `[gd_scene format=3]

[node name="Root" type="Node"]

[connection signal="pressed" from="Button" to="." method="_on_pressed" flags=3]
`;
    const scene = parseScene(content);

    expect(scene.connections).toHaveLength(1);
    expect(scene.connections[0].flags).toBe(3);
  });

  it('parses ext_resources correctly', () => {
    const content = `[gd_scene load_steps=2 format=3]

[ext_resource type="Texture2D" uid="uid://xyz789" path="res://icon.svg" id="1_icon"]

[node name="Root" type="Node"]
`;
    const scene = parseScene(content);

    expect(scene.extResources).toHaveLength(1);
    expect(scene.extResources[0]).toEqual({
      type: 'Texture2D',
      uid: 'uid://xyz789',
      path: 'res://icon.svg',
      id: '1_icon',
    });
  });

  it('parses sub_resources with properties', () => {
    const content = `[gd_scene format=3]

[sub_resource type="CircleShape2D" id="CircleShape2D_abc"]
radius = 32.0

[node name="Root" type="Node"]
`;
    const scene = parseScene(content);

    expect(scene.subResources).toHaveLength(1);
    expect(scene.subResources[0].type).toBe('CircleShape2D');
    expect(scene.subResources[0].id).toBe('CircleShape2D_abc');
    expect(scene.subResources[0].properties['radius']).toBe('32.0');
  });

  it('handles multi-line property values', () => {
    const content = `[gd_scene format=3]

[node name="Root" type="Node"]
metadata/_custom = {
"key": "value",
"nested": true
}
`;
    const scene = parseScene(content);

    expect(scene.nodes[0].properties['metadata/_custom']).toContain('"key": "value"');
  });
});

// ---------------------------------------------------------------------------
// groups parsing
// ---------------------------------------------------------------------------
describe('groups parsing', () => {
  it('parses groups=["enemies","destructible"] on a node into SceneNode.groups array', () => {
    const content = readFileSync(join(FIXTURES, 'sample-with-groups.tscn'), 'utf-8');
    const scene = parseScene(content);

    // Player has groups=["players", "persistent"]
    const player = scene.nodes.find(n => n.name === 'Player');
    expect(player).toBeDefined();
    expect(player!.groups).toEqual(['players', 'persistent']);

    // Enemy1 has groups=["enemies"]
    const enemy = scene.nodes.find(n => n.name === 'Enemy1');
    expect(enemy).toBeDefined();
    expect(enemy!.groups).toEqual(['enemies']);

    // Crate has groups=["destructible", "interactable"]
    const crate = scene.nodes.find(n => n.name === 'Crate');
    expect(crate).toBeDefined();
    expect(crate!.groups).toEqual(['destructible', 'interactable']);
  });

  it('parses groups=["single"] into single-element array', () => {
    const content = `[gd_scene format=3]

[node name="Root" type="Node2D"]

[node name="Solo" type="Node2D" parent="." groups=["loners"]]
`;
    const scene = parseScene(content);
    const solo = scene.nodes.find(n => n.name === 'Solo');
    expect(solo).toBeDefined();
    expect(solo!.groups).toEqual(['loners']);
  });

  it('returns undefined groups when node has no groups attribute', () => {
    const content = readFileSync(join(FIXTURES, 'sample-with-groups.tscn'), 'utf-8');
    const scene = parseScene(content);

    // Level (root) has no groups
    const level = scene.nodes.find(n => n.name === 'Level');
    expect(level).toBeDefined();
    expect(level!.groups).toBeUndefined();

    // EnemyInstance has no groups
    const enemyInstance = scene.nodes.find(n => n.name === 'EnemyInstance');
    expect(enemyInstance).toBeDefined();
    expect(enemyInstance!.groups).toBeUndefined();
  });

  it('parses both groups and instance attributes correctly', () => {
    const content = `[gd_scene format=3]

[node name="Root" type="Node2D"]

[node name="InstancedEnemy" parent="." instance=ExtResource("2_def") groups=["enemies", "targets"]]
`;
    const scene = parseScene(content);
    const node = scene.nodes.find(n => n.name === 'InstancedEnemy');
    expect(node).toBeDefined();
    expect(node!.instance).toBe('ExtResource("2_def")');
    expect(node!.groups).toEqual(['enemies', 'targets']);
  });

  it('does not break existing sample.tscn parsing (regression)', () => {
    const content = readFileSync(join(FIXTURES, 'sample.tscn'), 'utf-8');
    const scene = parseScene(content);

    // Verify structure hasn't changed
    expect(scene.format).toBe(3);
    expect(scene.uid).toBe('uid://cecaux1sm7mo0');
    expect(scene.loadSteps).toBe(4);
    expect(scene.extResources).toHaveLength(2);
    expect(scene.subResources).toHaveLength(1);
    expect(scene.nodes).toHaveLength(4);
    expect(scene.connections).toHaveLength(1);

    // No nodes in sample.tscn have groups, so all should be undefined
    for (const node of scene.nodes) {
      expect(node.groups).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// parseResource
// ---------------------------------------------------------------------------
describe('parseResource', () => {
  it('parses the sample.tres fixture into a complete ParsedResource', () => {
    const content = readFileSync(join(FIXTURES, 'sample.tres'), 'utf-8');
    const resource = parseResource(content);

    // Header
    expect(resource.type).toBe('StandardMaterial3D');
    expect(resource.format).toBe(3);
    expect(resource.uid).toBe('uid://mat123');
    expect(resource.loadSteps).toBe(2);

    // Ext resources
    expect(resource.extResources).toHaveLength(1);
    expect(resource.extResources[0]).toEqual({
      type: 'Texture2D',
      uid: 'uid://tex456',
      path: 'res://textures/brick.png',
      id: '1_tex',
    });

    // Sub resources
    expect(resource.subResources).toHaveLength(1);
    expect(resource.subResources[0].type).toBe('CompressedTexture2D');
    expect(resource.subResources[0].id).toBe('CompressedTexture2D_abc');

    // Resource properties
    expect(resource.properties['albedo_color']).toBe('Color(1, 0.64, 0.31, 1)');
    expect(resource.properties['albedo_texture']).toBe('ExtResource("1_tex")');
    expect(resource.properties['metallic']).toBe('0.5');
    expect(resource.properties['roughness']).toBe('0.8');
    expect(resource.properties['normal_enabled']).toBe('true');
  });

  it('parses a minimal resource', () => {
    const content = `[gd_resource type="Curve2D" format=3]

[resource]
bake_interval = 5.0
`;
    const resource = parseResource(content);

    expect(resource.type).toBe('Curve2D');
    expect(resource.format).toBe(3);
    expect(resource.extResources).toEqual([]);
    expect(resource.subResources).toEqual([]);
    expect(resource.properties['bake_interval']).toBe('5.0');
  });

  it('returns defaults for empty string', () => {
    const resource = parseResource('');

    expect(resource.type).toBe('');
    expect(resource.format).toBe(0);
    expect(resource.uid).toBeUndefined();
    expect(resource.loadSteps).toBeUndefined();
    expect(resource.extResources).toEqual([]);
    expect(resource.subResources).toEqual([]);
    expect(resource.properties).toEqual({});
  });

  it('parses resource with multiple properties', () => {
    const content = `[gd_resource type="Environment" format=3 uid="uid://env001"]

[resource]
background_mode = 1
background_color = Color(0.2, 0.3, 0.4, 1)
ambient_light_color = Color(1, 1, 1, 1)
ambient_light_energy = 0.5
`;
    const resource = parseResource(content);

    expect(resource.type).toBe('Environment');
    expect(resource.uid).toBe('uid://env001');
    expect(Object.keys(resource.properties)).toHaveLength(4);
    expect(resource.properties['background_mode']).toBe('1');
    expect(resource.properties['background_color']).toBe('Color(0.2, 0.3, 0.4, 1)');
    expect(resource.properties['ambient_light_color']).toBe('Color(1, 1, 1, 1)');
    expect(resource.properties['ambient_light_energy']).toBe('0.5');
  });

  it('parses resource with ext_resources', () => {
    const content = `[gd_resource type="ShaderMaterial" load_steps=2 format=3]

[ext_resource type="Shader" path="res://my_shader.gdshader" id="1_shd"]

[resource]
shader = ExtResource("1_shd")
`;
    const resource = parseResource(content);

    expect(resource.extResources).toHaveLength(1);
    expect(resource.extResources[0].type).toBe('Shader');
    expect(resource.extResources[0].path).toBe('res://my_shader.gdshader');
    expect(resource.properties['shader']).toBe('ExtResource("1_shd")');
  });
});
