/**
 * MCP Resource registrations for Godot project scenes and scripts.
 *
 * Exposes .tscn and .gd files as MCP resources so users can @mention them
 * in Claude Code for inline context.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative, basename } from 'path';
import type { ServerContext } from '../types.js';

/**
 * Recursively find files matching a given extension, skipping .godot/ and .git/ dirs.
 * Returns paths relative to the root directory.
 */
function findFilesRecursive(dir: string, ext: string, rootDir: string): string[] {
  const results: string[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    // Skip .godot/ and .git/ directories
    if (entry.isDirectory() && (entry.name === '.godot' || entry.name === '.git')) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(fullPath, ext, rootDir));
    } else if (entry.name.endsWith(ext)) {
      results.push(relative(rootDir, fullPath));
    }
  }

  return results;
}

/**
 * Resolve the project path from environment or cwd.
 * Returns the path if a valid Godot project (contains project.godot), or null.
 */
function resolveProjectPath(): string | null {
  const projectPath = process.env.GODOT_PROJECT_PATH || process.cwd();

  if (!existsSync(join(projectPath, 'project.godot'))) {
    return null;
  }

  return projectPath;
}

/**
 * Register MCP resources for Godot scenes and scripts.
 *
 * Registers two dynamic resource templates:
 * - godot://scene/{path} - .tscn scene files
 * - godot://script/{path} - .gd script files
 */
export function registerGodotResources(server: McpServer, _ctx: ServerContext): void {
  // Scene resource: godot://scene/{path}
  server.registerResource(
    'godot-scene',
    new ResourceTemplate('godot://scene/{path}', {
      list: async () => {
        const projectPath = resolveProjectPath();
        if (!projectPath) {
          return { resources: [] };
        }

        const scenes = findFilesRecursive(projectPath, '.tscn', projectPath);
        return {
          resources: scenes.map((scenePath) => ({
            uri: `godot://scene/${encodeURIComponent(scenePath).replace(/%2F/g, '/')}`,
            name: basename(scenePath),
            mimeType: 'text/plain' as const,
          })),
        };
      },
    }),
    {
      title: 'Godot Scene',
      description: 'A Godot scene file (.tscn)',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const projectPath = resolveProjectPath();
      const filePath = decodeURIComponent(String(variables.path));
      const absolutePath = projectPath ? join(projectPath, filePath) : filePath;

      const content = readFileSync(absolutePath, 'utf-8');
      return {
        contents: [{ uri: uri.href, text: content }],
      };
    },
  );

  // Script resource: godot://script/{path}
  server.registerResource(
    'godot-script',
    new ResourceTemplate('godot://script/{path}', {
      list: async () => {
        const projectPath = resolveProjectPath();
        if (!projectPath) {
          return { resources: [] };
        }

        const scripts = findFilesRecursive(projectPath, '.gd', projectPath);
        return {
          resources: scripts.map((scriptPath) => ({
            uri: `godot://script/${encodeURIComponent(scriptPath).replace(/%2F/g, '/')}`,
            name: basename(scriptPath),
            mimeType: 'text/plain' as const,
          })),
        };
      },
    }),
    {
      title: 'GDScript File',
      description: 'A GDScript source file (.gd)',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const projectPath = resolveProjectPath();
      const filePath = decodeURIComponent(String(variables.path));
      const absolutePath = projectPath ? join(projectPath, filePath) : filePath;

      const content = readFileSync(absolutePath, 'utf-8');
      return {
        contents: [{ uri: uri.href, text: content }],
      };
    },
  );
}
