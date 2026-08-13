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

/** Valid Godot identifier for node names and types written into [node] headers. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Valid .tscn property key: an identifier optionally followed by /-separated
 * path segments (Godot property paths like "physics/gravity",
 * "theme_override_colors/font_color", or indexed paths like "item/0/name").
 * Rejects whitespace, quotes, newlines, and '=' so a key cannot forge
 * extra property lines or sections.
 */
const PROPERTY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*(\/[A-Za-z0-9_]+)*$/;

/**
 * Escape a string for embedding inside a double-quoted .tscn string literal.
 *
 * Prevents quote/newline injection from breaking out of the literal and
 * forging additional sections or properties in the scene file.
 */
function escapeTscnString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
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
    return `"${escapeTscnString(value)}"`;
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
    return `"${escapeTscnString(JSON.stringify(value))}"`;
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

  // Validate name/type so they cannot break out of the [node ...] header
  if (!IDENTIFIER_RE.test(opts.nodeName)) {
    throw new Error(
      `Invalid node name "${opts.nodeName}": must match [A-Za-z_][A-Za-z0-9_]*`,
    );
  }
  if (!IDENTIFIER_RE.test(opts.nodeType)) {
    throw new Error(
      `Invalid node type "${opts.nodeType}": must match [A-Za-z_][A-Za-z0-9_]*`,
    );
  }

  const parent = resolveParentPath(opts.parentNodePath);

  // The parent attribute is a node path that may legally contain
  // non-identifier characters (Godot allows e.g. spaces in node names), but
  // quotes, backslashes, and line breaks are illegal in Godot node names, so
  // reject them rather than escape - they can only be an injection attempt.
  if (/["\\\n\r]/.test(parent)) {
    throw new Error(
      `Invalid parent node path "${parent}": must not contain quotes, backslashes, or line breaks`,
    );
  }

  // Build the new node section
  let nodeSection = `\n[node name="${opts.nodeName}" type="${opts.nodeType}" parent="${parent}"]`;

  // Add property lines. Keys are validated so they cannot forge extra
  // property lines or [node]/[sub_resource] sections.
  if (opts.properties) {
    for (const [key, value] of Object.entries(opts.properties)) {
      if (!PROPERTY_KEY_RE.test(key)) {
        throw new Error(
          `Invalid property key "${key}": must be an identifier or /-separated property path`,
        );
      }
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
