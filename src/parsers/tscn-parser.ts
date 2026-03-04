/**
 * Text-format parser for Godot .tscn (scene) and .tres (resource) files.
 *
 * Parses the line-based format into structured TypeScript objects.
 * All property values are stored as raw strings — no type conversion
 * is performed. This keeps the parser fast (~1ms) and avoids spawning
 * a Godot process (~200ms) for read-only operations.
 */

import type {
  ParsedScene,
  ParsedResource,
  SceneNode,
  ExtResource,
  SubResource,
  Connection,
} from './tscn-types.js';

/** Parsed section header: [type key=val key="val" ...] */
interface SectionHeader {
  type: string;
  attributes: Record<string, string>;
}

/**
 * Parse a bracketed section header line.
 *
 * Examples:
 *   [gd_scene load_steps=4 format=3 uid="uid://abc"]
 *   [node name="Player" type="CharacterBody3D" parent="."]
 *   [connection signal="pressed" from="Button" to="." method="_on_pressed"]
 *
 * Returns null if the line is not a valid section header.
 */
function parseSectionHeader(line: string): SectionHeader | null {
  const match = line.match(/^\[(\w+)(.*?)?\]$/);
  if (!match) return null;

  const type = match[1];
  const attrStr = match[2]?.trim() || '';
  const attributes: Record<string, string> = {};

  // Parse key=[array], key="value", or key=value pairs
  const attrRegex = /(\w+)=(?:\[([^\]]*)\]|"([^"]*?)"|(\S+))/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
    if (attrMatch[2] !== undefined) {
      // Array value -- store with brackets so callers can identify it
      attributes[attrMatch[1]] = `[${attrMatch[2]}]`;
    } else {
      attributes[attrMatch[1]] = attrMatch[3] ?? attrMatch[4];
    }
  }

  return { type, attributes };
}

/**
 * Parse a property assignment line: `key = value`
 *
 * Splits on the first ` = ` delimiter. Returns [key, value] or null
 * if the line doesn't contain a property assignment.
 */
function parsePropertyLine(line: string): [string, string] | null {
  const eqIdx = line.indexOf(' = ');
  if (eqIdx === -1) return null;
  return [line.substring(0, eqIdx).trim(), line.substring(eqIdx + 3).trim()];
}

/**
 * Check if a string value has balanced brackets/parentheses,
 * indicating it is a complete (not multi-line) value.
 */
function isBalanced(value: string): boolean {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escapeNext = false;

  for (const ch of value) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    switch (ch) {
      case '(':
        parenDepth++;
        break;
      case ')':
        parenDepth--;
        break;
      case '{':
        braceDepth++;
        break;
      case '}':
        braceDepth--;
        break;
      case '[':
        bracketDepth++;
        break;
      case ']':
        bracketDepth--;
        break;
    }
  }

  return parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
}

/**
 * Build an ExtResource from a section header's attributes.
 */
function buildExtResource(attrs: Record<string, string>): ExtResource {
  const resource: ExtResource = {
    type: attrs['type'] || '',
    path: attrs['path'] || '',
    id: attrs['id'] || '',
  };
  if (attrs['uid']) {
    resource.uid = attrs['uid'];
  }
  return resource;
}

/**
 * Build a SceneNode from a section header's attributes.
 */
function buildNode(attrs: Record<string, string>): SceneNode {
  const node: SceneNode = {
    name: attrs['name'] || '',
    properties: {},
  };
  if (attrs['type']) node.type = attrs['type'];
  if (attrs['parent']) node.parent = attrs['parent'];
  if (attrs['instance']) node.instance = attrs['instance'];
  if (attrs['groups']) {
    // Extract individual group names from the array string e.g. ["enemies", "targets"]
    const groupMatches = attrs['groups'].match(/"([^"]*)"/g);
    if (groupMatches) {
      node.groups = groupMatches.map((g) => g.slice(1, -1));
    }
  }
  return node;
}

/**
 * Build a Connection from a section header's attributes.
 */
function buildConnection(attrs: Record<string, string>): Connection {
  const conn: Connection = {
    signal: attrs['signal'] || '',
    from: attrs['from'] || '',
    to: attrs['to'] || '',
    method: attrs['method'] || '',
  };
  if (attrs['flags'] !== undefined) {
    conn.flags = parseInt(attrs['flags'], 10);
  }
  return conn;
}

/**
 * Parse .tscn file content into a structured ParsedScene.
 *
 * The parser iterates line by line, tracking the current section type.
 * Property lines (key = value) are collected into the current section's
 * properties. Multi-line values (unbalanced brackets) are accumulated.
 */
export function parseScene(content: string): ParsedScene {
  const scene: ParsedScene = {
    format: 0,
    extResources: [],
    subResources: [],
    nodes: [],
    connections: [],
  };

  if (!content.trim()) return scene;

  const lines = content.split('\n');

  // Track current section target for property lines
  let currentTarget: { properties: Record<string, string> } | null = null;
  // Multi-line accumulator
  let multiLineKey: string | null = null;
  let multiLineValue = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Skip empty lines
    if (trimmed === '') {
      continue;
    }

    // Handle multi-line property values
    if (multiLineKey !== null) {
      multiLineValue += '\n' + trimmed;
      if (isBalanced(multiLineValue)) {
        if (currentTarget) {
          currentTarget.properties[multiLineKey] = multiLineValue;
        }
        multiLineKey = null;
        multiLineValue = '';
      }
      continue;
    }

    // Try parsing as section header
    const header = parseSectionHeader(trimmed);
    if (header) {
      switch (header.type) {
        case 'gd_scene': {
          const fmt = header.attributes['format'];
          if (fmt) scene.format = parseInt(fmt, 10);
          if (header.attributes['uid']) scene.uid = header.attributes['uid'];
          const ls = header.attributes['load_steps'];
          if (ls) scene.loadSteps = parseInt(ls, 10);
          currentTarget = null;
          break;
        }

        case 'ext_resource': {
          scene.extResources.push(buildExtResource(header.attributes));
          currentTarget = null;
          break;
        }

        case 'sub_resource': {
          const sub: SubResource = {
            type: header.attributes['type'] || '',
            id: header.attributes['id'] || '',
            properties: {},
          };
          scene.subResources.push(sub);
          currentTarget = sub;
          break;
        }

        case 'node': {
          const node = buildNode(header.attributes);
          scene.nodes.push(node);
          currentTarget = node;
          break;
        }

        case 'connection': {
          scene.connections.push(buildConnection(header.attributes));
          currentTarget = null;
          break;
        }

        default:
          currentTarget = null;
          break;
      }
      continue;
    }

    // Try parsing as property line
    const prop = parsePropertyLine(trimmed);
    if (prop && currentTarget) {
      const [key, value] = prop;
      if (isBalanced(value)) {
        currentTarget.properties[key] = value;
      } else {
        // Start multi-line value accumulation
        multiLineKey = key;
        multiLineValue = value;
      }
    }
  }

  return scene;
}

/**
 * Parse .tres file content into a structured ParsedResource.
 *
 * Same approach as parseScene but looks for [gd_resource] header
 * and a [resource] section containing the main resource's properties.
 */
export function parseResource(content: string): ParsedResource {
  const resource: ParsedResource = {
    type: '',
    format: 0,
    extResources: [],
    subResources: [],
    properties: {},
  };

  if (!content.trim()) return resource;

  const lines = content.split('\n');

  // Track current section target for property lines
  let currentTarget: { properties: Record<string, string> } | null = null;
  // Multi-line accumulator
  let multiLineKey: string | null = null;
  let multiLineValue = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (trimmed === '') {
      continue;
    }

    // Handle multi-line property values
    if (multiLineKey !== null) {
      multiLineValue += '\n' + trimmed;
      if (isBalanced(multiLineValue)) {
        if (currentTarget) {
          currentTarget.properties[multiLineKey] = multiLineValue;
        }
        multiLineKey = null;
        multiLineValue = '';
      }
      continue;
    }

    // Try parsing as section header
    const header = parseSectionHeader(trimmed);
    if (header) {
      switch (header.type) {
        case 'gd_resource': {
          resource.type = header.attributes['type'] || '';
          const fmt = header.attributes['format'];
          if (fmt) resource.format = parseInt(fmt, 10);
          if (header.attributes['uid']) resource.uid = header.attributes['uid'];
          const ls = header.attributes['load_steps'];
          if (ls) resource.loadSteps = parseInt(ls, 10);
          currentTarget = null;
          break;
        }

        case 'ext_resource': {
          resource.extResources.push(buildExtResource(header.attributes));
          currentTarget = null;
          break;
        }

        case 'sub_resource': {
          const sub: SubResource = {
            type: header.attributes['type'] || '',
            id: header.attributes['id'] || '',
            properties: {},
          };
          resource.subResources.push(sub);
          currentTarget = sub;
          break;
        }

        case 'resource': {
          // The main [resource] section — properties go directly into resource.properties
          currentTarget = resource;
          break;
        }

        default:
          currentTarget = null;
          break;
      }
      continue;
    }

    // Try parsing as property line
    const prop = parsePropertyLine(trimmed);
    if (prop && currentTarget) {
      const [key, value] = prop;
      if (isBalanced(value)) {
        currentTarget.properties[key] = value;
      } else {
        multiLineKey = key;
        multiLineValue = value;
      }
    }
  }

  return resource;
}
