/**
 * TypeScript-native .tscn text manipulation for adding nodes.
 *
 * Operates on raw .tscn text content, appending new [node] sections
 * without GDScript execution. This avoids the autoload corruption
 * problem where `load()` -> `instantiate()` -> `pack()` triggers
 * script execution in headless mode where autoload singletons
 * don't exist.
 */

/**
 * Options for adding a node to a scene.
 */
export interface AddNodeOptions {
  /** Path to parent node (e.g., "root", "root/Player", "root/Player/Body"). */
  parentNodePath?: string;
  /** Godot node type (e.g., "Sprite2D", "CollisionShape2D"). */
  nodeType: string;
  /** Name for the new node. */
  nodeName: string;
  /** Optional properties to set on the node. */
  properties?: Record<string, unknown>;
}

/**
 * Serialize a property value to Godot .tscn format.
 *
 * - Objects with x,y -> Vector2(x, y)
 * - Objects with x,y,z -> Vector3(x, y, z)
 * - Objects with r,g,b -> Color(r, g, b, a)
 * - Booleans -> true/false
 * - Numbers -> literal
 * - Strings -> "quoted"
 */
function serializeGodotValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    // Color: has r, g, b keys
    if ('r' in obj && 'g' in obj && 'b' in obj) {
      const a = 'a' in obj ? obj.a : 1;
      return `Color(${obj.r}, ${obj.g}, ${obj.b}, ${a})`;
    }
    // Vector3: has x, y, z keys
    if ('x' in obj && 'y' in obj && 'z' in obj) {
      return `Vector3(${obj.x}, ${obj.y}, ${obj.z})`;
    }
    // Vector2: has x, y keys
    if ('x' in obj && 'y' in obj) {
      return `Vector2(${obj.x}, ${obj.y})`;
    }
    // Fallback: JSON string
    return `"${JSON.stringify(value)}"`;
  }
  return String(value);
}

/**
 * Convert a user-facing parent node path to the .tscn `parent` attribute value.
 *
 * - undefined / "root" -> "." (direct child of root)
 * - "root/X" -> "X"
 * - "root/X/Y" -> "X/Y"
 */
function resolveParentPath(parentNodePath?: string): string {
  if (!parentNodePath || parentNodePath === 'root') {
    return '.';
  }
  // Strip "root/" prefix
  if (parentNodePath.startsWith('root/')) {
    return parentNodePath.substring(5);
  }
  // If no root prefix, use as-is (already a .tscn-style path)
  return parentNodePath;
}

/**
 * Add a node to .tscn scene content via text manipulation.
 *
 * Appends a new [node] section to the scene content. Inserts the node
 * BEFORE any [connection] sections (connections must come last in .tscn).
 * Does not modify any existing content.
 *
 * @throws Error if content is not valid .tscn (missing [gd_scene] header)
 */
export function addNodeToScene(content: string, opts: AddNodeOptions): string {
  // Validate that this is a .tscn file
  if (!content.trimStart().startsWith('[gd_scene')) {
    throw new Error('Invalid .tscn content: missing [gd_scene] header');
  }

  const parent = resolveParentPath(opts.parentNodePath);

  // Build the new node section
  let nodeSection = `\n[node name="${opts.nodeName}" type="${opts.nodeType}" parent="${parent}"]`;

  // Add property lines
  if (opts.properties) {
    for (const [key, value] of Object.entries(opts.properties)) {
      nodeSection += `\n${key} = ${serializeGodotValue(value)}`;
    }
  }

  nodeSection += '\n';

  // Find the first [connection] section to insert before it
  const connectionRegex = /^\[connection /m;
  const connectionMatch = connectionRegex.exec(content);

  if (connectionMatch) {
    // Insert new node before the first [connection]
    const insertIdx = connectionMatch.index;
    return content.substring(0, insertIdx) + nodeSection + '\n' + content.substring(insertIdx);
  }

  // No connections -- append to end of file
  // Ensure there's a trailing newline before appending
  const trimmedContent = content.trimEnd();
  return trimmedContent + '\n' + nodeSection;
}
