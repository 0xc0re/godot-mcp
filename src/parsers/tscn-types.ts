/**
 * Type definitions for parsed Godot .tscn and .tres file data.
 *
 * These types represent the structured output of text-format parsing.
 * Property values are stored as raw strings — no type conversion is
 * performed (that is Godot's responsibility).
 */

/**
 * An external resource referenced by a scene or resource file.
 * Corresponds to [ext_resource] sections in .tscn/.tres files.
 */
export interface ExtResource {
  type: string;
  uid?: string;
  path: string;
  id: string;
}

/**
 * A sub-resource defined inline within a scene or resource file.
 * Corresponds to [sub_resource] sections in .tscn/.tres files.
 */
export interface SubResource {
  type: string;
  id: string;
  properties: Record<string, string>;
}

/**
 * A node in a scene tree.
 * Corresponds to [node] sections in .tscn files.
 *
 * Root node has no `parent` field. Direct children of root have parent=".".
 * Deeper children use path notation: parent="NodeA/NodeB".
 */
export interface SceneNode {
  name: string;
  type?: string;
  parent?: string;
  instance?: string;
  groups?: string[];
  properties: Record<string, string>;
}

/**
 * A signal connection between nodes.
 * Corresponds to [connection] sections in .tscn files.
 */
export interface Connection {
  signal: string;
  from: string;
  to: string;
  method: string;
  flags?: number;
}

/**
 * Structured representation of a parsed .tscn scene file.
 */
export interface ParsedScene {
  format: number;
  uid?: string;
  loadSteps?: number;
  extResources: ExtResource[];
  subResources: SubResource[];
  nodes: SceneNode[];
  connections: Connection[];
}

/**
 * Structured representation of a parsed .tres resource file.
 */
export interface ParsedResource {
  type: string;
  format: number;
  uid?: string;
  loadSteps?: number;
  extResources: ExtResource[];
  subResources: SubResource[];
  properties: Record<string, string>;
}
