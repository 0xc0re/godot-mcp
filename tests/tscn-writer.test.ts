/**
 * Tests for tscn-writer: TypeScript-native .tscn text manipulation.
 *
 * addNodeToScene appends a [node] section to .tscn content without
 * GDScript execution, avoiding autoload-related scene corruption.
 */

import { describe, it, expect } from 'vitest';
import { addNodeToScene } from '../src/parsers/tscn-writer.js';
import { parseScene } from '../src/parsers/tscn-parser.js';

// Minimal valid .tscn scene with root node
const MINIMAL_SCENE = `[gd_scene load_steps=2 format=3 uid="uid://abc123"]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_abc"]

[node name="Main" type="Node2D"]
script = ExtResource("1_abc")
`;

// Scene with connections at the end
const SCENE_WITH_CONNECTIONS = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_abc"]

[node name="Main" type="Node2D"]
script = ExtResource("1_abc")

[node name="Button" type="Button" parent="."]

[connection signal="pressed" from="Button" to="." method="_on_button_pressed"]
`;

// Scene with autoload-referencing scripts (the problematic case)
const SCENE_WITH_AUTOLOADS = `[gd_scene load_steps=3 format=3 uid="uid://xyz"]

[ext_resource type="Script" path="res://scripts/player.gd" id="1_p"]
[ext_resource type="PackedScene" path="res://scenes/weapon.tscn" id="2_w"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_p")
speed = 200.0

[node name="Sprite" type="Sprite2D" parent="."]

[node name="CollisionShape" type="CollisionShape2D" parent="."]
`;

describe('tscn-writer', () => {
  describe('addNodeToScene', () => {
    it('adds a child node with correct parent="."', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Sprite2D',
        nodeName: 'MySprite',
      });

      expect(result).toContain('[node name="MySprite" type="Sprite2D" parent="."]');
    });

    it('uses parent="." when parentNodePath is "root"', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        parentNodePath: 'root',
        nodeType: 'Camera2D',
        nodeName: 'MainCamera',
      });

      expect(result).toContain('[node name="MainCamera" type="Camera2D" parent="."]');
    });

    it('maps "root/Player" to parent="Player"', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        parentNodePath: 'root/Player',
        nodeType: 'Sprite2D',
        nodeName: 'PlayerSprite',
      });

      expect(result).toContain('[node name="PlayerSprite" type="Sprite2D" parent="Player"]');
    });

    it('maps "root/Player/Body" to parent="Player/Body"', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        parentNodePath: 'root/Player/Body',
        nodeType: 'CollisionShape2D',
        nodeName: 'Shape',
      });

      expect(result).toContain('[node name="Shape" type="CollisionShape2D" parent="Player/Body"]');
    });

    it('preserves all existing ext_resources, nodes, and properties', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'InfoLabel',
      });

      // All original content must still be present
      expect(result).toContain('[gd_scene load_steps=2 format=3 uid="uid://abc123"]');
      expect(result).toContain('[ext_resource type="Script" path="res://scripts/main.gd" id="1_abc"]');
      expect(result).toContain('[node name="Main" type="Node2D"]');
      expect(result).toContain('script = ExtResource("1_abc")');
      // New node also present
      expect(result).toContain('[node name="InfoLabel" type="Label" parent="."]');
    });

    it('places new node before [connection] sections', () => {
      const result = addNodeToScene(SCENE_WITH_CONNECTIONS, {
        nodeType: 'Label',
        nodeName: 'StatusLabel',
      });

      const nodeIdx = result.indexOf('[node name="StatusLabel"');
      const connIdx = result.indexOf('[connection');
      expect(nodeIdx).toBeGreaterThan(-1);
      expect(connIdx).toBeGreaterThan(-1);
      expect(nodeIdx).toBeLessThan(connIdx);
    });

    it('serializes Vector2 properties correctly', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Sprite2D',
        nodeName: 'Positioned',
        properties: {
          position: { x: 100, y: 200 },
        },
      });

      expect(result).toContain('position = Vector2(100, 200)');
    });

    it('serializes Vector3 properties correctly', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Node3D',
        nodeName: 'Box',
        properties: {
          position: { x: 1, y: 2, z: 3 },
        },
      });

      expect(result).toContain('position = Vector3(1, 2, 3)');
    });

    it('serializes Color properties correctly', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'ColorLabel',
        properties: {
          modulate: { r: 1, g: 0, b: 0, a: 1 },
        },
      });

      expect(result).toContain('modulate = Color(1, 0, 0, 1)');
    });

    it('serializes boolean properties correctly', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Sprite2D',
        nodeName: 'Hidden',
        properties: {
          visible: false,
        },
      });

      expect(result).toContain('visible = false');
    });

    it('serializes number properties correctly', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Sprite2D',
        nodeName: 'Scaled',
        properties: {
          z_index: 5,
        },
      });

      expect(result).toContain('z_index = 5');
    });

    it('serializes string properties with quotes', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'Greeting',
        properties: {
          text: 'Hello World',
        },
      });

      expect(result).toContain('text = "Hello World"');
    });

    it('preserves autoload-referencing scripts untouched', () => {
      const result = addNodeToScene(SCENE_WITH_AUTOLOADS, {
        nodeType: 'Area2D',
        nodeName: 'HitBox',
      });

      // All original content preserved exactly
      expect(result).toContain('script = ExtResource("1_p")');
      expect(result).toContain('speed = 200.0');
      expect(result).toContain('[ext_resource type="Script" path="res://scripts/player.gd" id="1_p"]');
      expect(result).toContain('[ext_resource type="PackedScene" path="res://scenes/weapon.tscn" id="2_w"]');
      // New node added
      expect(result).toContain('[node name="HitBox" type="Area2D" parent="."]');
    });

    it('rejects a node name that tries to break out of the [node] header', () => {
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Node2D',
          nodeName: 'Evil" type="Node2D"] [node name="Injected',
        });
      }).toThrow(/Invalid node name/);
    });

    it('rejects a node type that tries to break out of the [node] header', () => {
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Node2D"] [sub_resource type="GDScript',
          nodeName: 'Safe',
        });
      }).toThrow(/Invalid node type/);
    });

    it('rejects node names with spaces or leading digits', () => {
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, { nodeType: 'Node2D', nodeName: 'My Node' });
      }).toThrow(/Invalid node name/);
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, { nodeType: 'Node2D', nodeName: '2Fast' });
      }).toThrow(/Invalid node name/);
    });

    it('accepts underscore-prefixed identifiers for names and types', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Node2D',
        nodeName: '_internal_1',
      });
      expect(result).toContain('[node name="_internal_1" type="Node2D" parent="."]');
    });

    it('escapes double quotes in string property values', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'Quoted',
        properties: { text: 'say "hi"' },
      });
      expect(result).toContain('text = "say \\"hi\\""');
    });

    it('escapes backslashes and newlines in string property values', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'Multiline',
        properties: { text: 'line1\nline2\\end' },
      });
      expect(result).toContain('text = "line1\\nline2\\\\end"');
    });

    it('keeps a malicious property string inert through a parse round-trip', () => {
      // A string value that tries to forge a new [node] section via a quote +
      // newline breakout. After escaping it must stay inside the string literal.
      const malicious = 'x"\n\n[node name="Injected" type="Node2D" parent="."]\ntext = "pwn';
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'Victim',
        properties: { text: malicious },
      });

      const parsed = parseScene(result);
      const names = parsed.nodes.map((n) => n.name);
      expect(names).toContain('Victim');
      expect(names).not.toContain('Injected');
      // Only the original root and the added node exist
      expect(parsed.nodes).toHaveLength(2);
    });

    it('rejects a property key that tries to forge extra lines or sections', () => {
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Label',
          nodeName: 'Victim',
          properties: {
            'x = 1\n[node name="Injected" type="Node2D" parent="."]\ny': 2,
          },
        });
      }).toThrow(/Invalid property key/);
    });

    it('accepts Godot property-path keys with slashes and numeric segments', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Node2D',
        nodeName: 'Pathy',
        properties: {
          'physics/gravity': 9.8,
          'theme_override_colors/font_color': { r: 1, g: 0, b: 0 },
          'item/0/name': 'first',
        },
      });
      expect(result).toContain('physics/gravity = 9.8');
      expect(result).toContain('theme_override_colors/font_color = Color(1, 0, 0, 1)');
      expect(result).toContain('item/0/name = "first"');
    });

    it('rejects a forged Color component instead of interpolating it raw', () => {
      // A string component in a Color object would previously be interpolated
      // raw into unquoted Color(...) syntax, forging a new [node] section.
      const forged = '0, 0, 0, 0)\n\n[node name="Injected" type="Node2D" parent="."]\nx = Color(0';
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Sprite2D',
          nodeName: 'Victim',
          properties: { modulate: { r: forged, g: 0, b: 0 } },
        });
      }).toThrow(/Invalid numeric component/);
    });

    it('rejects a forged Vector component instead of interpolating it raw', () => {
      const forged = '0, 0)\n\n[node name="Injected" type="Node2D" parent="."]\nposition = Vector2(0';
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Node2D',
          nodeName: 'Victim',
          properties: { position: { x: forged, y: 1 } },
        });
      }).toThrow(/Invalid numeric component/);
    });

    it('accepts numeric-string components by coercing them with Number()', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Node2D',
        nodeName: 'Coerced',
        properties: { position: { x: '1.5', y: '2' } },
      });
      expect(result).toContain('position = Vector2(1.5, 2)');

      const parsed = parseScene(result);
      expect(parsed.nodes.map((n) => n.name)).toEqual(['Main', 'Coerced']);
    });

    it('rejects NaN and non-finite numeric components', () => {
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Node2D',
          nodeName: 'Victim',
          properties: { position: { x: NaN, y: 0 } },
        });
      }).toThrow(/Invalid numeric component/);
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          nodeType: 'Node2D',
          nodeName: 'Victim',
          properties: { scale: { x: Infinity, y: 1 } },
        });
      }).toThrow(/Invalid numeric component/);
    });

    it('keeps a malicious array value inert through a parse round-trip (fallback escape)', () => {
      // Arrays hit the final fallback, which previously emitted raw
      // String(value) — a crafted element could forge a [node] section.
      const maliciousArray = ['x"\n\n[node name="Injected" type="Node2D" parent="."]\ny = "pwn'];
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Label',
        nodeName: 'Victim',
        properties: { items: maliciousArray },
      });

      const parsed = parseScene(result);
      const names = parsed.nodes.map((n) => n.name);
      expect(names).toContain('Victim');
      expect(names).not.toContain('Injected');
      expect(parsed.nodes).toHaveLength(2);
    });

    it('serializes null and undefined values as null literals', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        nodeType: 'Node2D',
        nodeName: 'Nullish',
        properties: { a: null, b: undefined },
      });
      expect(result).toContain('a = null');
      expect(result).toContain('b = null');
    });

    it('rejects a parentNodePath that tries to break out of the parent attribute', () => {
      // A parent path that tries to close the attribute and forge a new
      // [node] section. Quotes/backslashes/newlines are illegal in Godot node
      // names, so this can only be an injection attempt and must be rejected.
      const maliciousParent = 'root/Evil"]\n\n[node name="Injected" type="Node2D" parent=".';
      expect(() => {
        addNodeToScene(MINIMAL_SCENE, {
          parentNodePath: maliciousParent,
          nodeType: 'Label',
          nodeName: 'Victim',
        });
      }).toThrow(/Invalid parent node path/);
    });

    it('accepts a parent path with spaces (legal in Godot node names)', () => {
      const result = addNodeToScene(MINIMAL_SCENE, {
        parentNodePath: 'root/My Panel/Sub Node',
        nodeType: 'Label',
        nodeName: 'Caption',
      });
      expect(result).toContain('[node name="Caption" type="Label" parent="My Panel/Sub Node"]');

      const parsed = parseScene(result);
      expect(parsed.nodes.map((n) => n.name)).toEqual(['Main', 'Caption']);
    });

    it('throws on invalid .tscn content', () => {
      expect(() => {
        addNodeToScene('not a valid scene file', {
          nodeType: 'Node2D',
          nodeName: 'Test',
        });
      }).toThrow();
    });
  });
});
