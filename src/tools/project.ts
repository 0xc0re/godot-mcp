/**
 * Project tool domain: get_godot_version, list_projects, get_project_info
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, basename } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { execGodot, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

const DEBUG_MODE: boolean = process.env.DEBUG === 'true';

function logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}

/**
 * Find Godot projects in a directory.
 */
function findGodotProjects(
  directory: string,
  recursive: boolean,
): Array<{ path: string; name: string }> {
  const projects: Array<{ path: string; name: string }> = [];

  try {
    const projectFile = join(directory, 'project.godot');
    if (existsSync(projectFile)) {
      projects.push({ path: directory, name: basename(directory) });
    }

    if (!recursive) {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subdir = join(directory, entry.name);
          const subProjectFile = join(subdir, 'project.godot');
          if (existsSync(subProjectFile)) {
            projects.push({ path: subdir, name: entry.name });
          }
        }
      }
    } else {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          const subdir = join(directory, entry.name);
          const subProjectFile = join(subdir, 'project.godot');
          if (existsSync(subProjectFile)) {
            projects.push({ path: subdir, name: entry.name });
          } else {
            const subProjects = findGodotProjects(subdir, true);
            projects.push(...subProjects);
          }
        }
      }
    }
  } catch (error) {
    logDebug(`Error searching directory ${directory}: ${error}`);
  }

  return projects;
}

/**
 * Get async project structure by counting files recursively.
 */
function getProjectStructureAsync(projectPath: string): {
  scenes: number;
  scripts: number;
  assets: number;
  other: number;
} {
  const structure = { scenes: 0, scripts: 0, assets: 0, other: 0 };

  try {
    const scanDirectory = (currentPath: string) => {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(currentPath, entry.name);
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          scanDirectory(entryPath);
        } else if (entry.isFile()) {
          const ext = entry.name.split('.').pop()?.toLowerCase();
          if (ext === 'tscn') {
            structure.scenes++;
          } else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') {
            structure.scripts++;
          } else if (
            ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext || '')
          ) {
            structure.assets++;
          } else {
            structure.other++;
          }
        }
      }
    };

    scanDirectory(projectPath);
  } catch (error) {
    logDebug(`Error getting project structure: ${error}`);
  }

  return structure;
}

export function registerProjectTools(server: McpServer, ctx: ServerContext): void {
  // Tool 5: get_godot_version
  server.registerTool(
    'get_godot_version',
    {
      title: 'Get Godot Version',
      description: 'Get the installed Godot version',
    },
    async () => {
      try {
        logDebug('Getting Godot version');
        const { stdout } = await execGodot(ctx.godotPath, ['--version']);
        return {
          content: [{ type: 'text' as const, text: stdout.trim() }],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to get Godot version: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]);
      }
    },
  );

  // Tool 6: list_projects
  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      description: 'List Godot projects in a directory',
      inputSchema: {
        directory: z.string().describe('Directory to search for Godot projects'),
        recursive: z
          .boolean()
          .optional()
          .describe('Whether to search recursively (default: false)'),
      },
    },
    async ({ directory, recursive }) => {
      if (!validatePath(directory)) {
        return toolError('Invalid directory path', [
          'Provide a valid path without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        logDebug(`Listing Godot projects in directory: ${directory}`);
        if (!existsSync(directory)) {
          return toolError(`Directory does not exist: ${directory}`, [
            'Provide a valid directory path that exists on the system',
          ]);
        }

        const isRecursive = recursive === true;
        const projects = findGodotProjects(directory, isRecursive);

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(projects, null, 2) },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to list projects: ${errorMessage}`, [
          'Ensure the directory exists and is accessible',
          'Check if you have permission to read the directory',
        ]);
      }
    },
  );

  // Tool 7: get_project_info
  server.registerTool(
    'get_project_info',
    {
      title: 'Get Project Info',
      description: 'Retrieve metadata about a Godot project',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
      },
    },
    async ({ project_path }) => {
      if (!validatePath(project_path)) {
        return toolError('Invalid project path', [
          'Provide a valid path without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        logDebug(`Getting project info for: ${project_path}`);

        const { stdout } = await execGodot(ctx.godotPath, ['--version']);
        const projectStructure = getProjectStructureAsync(project_path);

        let projectName = basename(project_path);
        try {
          const projectFileContent = readFileSync(projectFile, 'utf8');
          const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
          if (configNameMatch && configNameMatch[1]) {
            projectName = configNameMatch[1];
            logDebug(`Found project name in config: ${projectName}`);
          }
        } catch (error) {
          logDebug(`Error reading project file: ${error}`);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  name: projectName,
                  path: project_path,
                  godotVersion: stdout.trim(),
                  structure: projectStructure,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to get project info: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
