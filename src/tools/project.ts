/**
 * Project tool domain: get_godot_version, list_projects, get_project_info,
 * read_project_settings, modify_project_setting
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, basename } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { execGodot, runOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, textResult } from './common.js';
import { logger } from '../logger.js';
import { parseProjectSettings } from '../parsers/project-parser.js';

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
    logger.debug(`Error searching directory ${directory}: ${error}`);
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
    logger.debug(`Error getting project structure: ${error}`);
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
        logger.debug('Getting Godot version');
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
        logger.debug(`Listing Godot projects in directory: ${directory}`);
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
    withProject(
      {
        catchPrefix: 'Failed to get project info',
      },
      async ({ project_path }) => {
        const projectFile = join(project_path, 'project.godot');
        logger.debug(`Getting project info for: ${project_path}`);

        const { stdout } = await execGodot(ctx.godotPath, ['--version']);
        const projectStructure = getProjectStructureAsync(project_path);

        let projectName = basename(project_path);
        try {
          const projectFileContent = readFileSync(projectFile, 'utf8');
          const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
          if (configNameMatch && configNameMatch[1]) {
            projectName = configNameMatch[1];
            logger.debug(`Found project name in config: ${projectName}`);
          }
        } catch (error) {
          logger.debug(`Error reading project file: ${error}`);
        }

        return textResult(
          JSON.stringify(
            {
              name: projectName,
              path: project_path,
              godotVersion: stdout.trim(),
              structure: projectStructure,
            },
            null,
            2,
          ),
        );
      },
    ),
  );

  // Tool 8: read_project_settings
  server.registerTool(
    'read_project_settings',
    {
      title: 'Read Project Settings',
      description:
        'Read and parse project.godot settings as structured JSON. ' +
        'Returns all sections (application, autoload, rendering, etc.) or a specific section.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        section: z
          .string()
          .optional()
          .describe('Filter to a specific section (e.g. "autoload", "rendering")'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to read project settings',
        catchSuggestions: [
          'Verify the project path is accessible',
          'Check that project.godot is a valid file',
        ],
      },
      async ({ project_path, section }) => {
        const projectFile = join(project_path, 'project.godot');
        logger.debug(`Reading project settings from: ${projectFile}`);
        const content = readFileSync(projectFile, 'utf8');
        const parsed = parseProjectSettings(content);

        if (section) {
          const sectionData = parsed.sections[section] || {};
          return textResult(JSON.stringify(sectionData, null, 2));
        }

        return textResult(JSON.stringify(parsed, null, 2));
      },
    ),
  );

  // Tool 9: modify_project_setting
  server.registerTool(
    'modify_project_setting',
    {
      title: 'Modify Project Setting',
      description:
        'Set or delete a project.godot setting using Godot ConfigFile API. ' +
        'Uses headless Godot for correct type handling.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        section: z.string().describe('Section name (e.g. "application", "autoload")'),
        key: z.string().describe('Setting key (e.g. "config/name", "GameManager")'),
        value: z
          .string()
          .optional()
          .describe('Setting value (required for action "set")'),
        action: z
          .enum(['set', 'delete'])
          .optional()
          .default('set')
          .describe('Action: "set" (default) or "delete"'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to modify project setting',
        catchSuggestions: [
          'Verify the project path is accessible',
          'Check that Godot is installed and GODOT_PATH is set',
        ],
      },
      async ({ project_path, section, key, value, action }) => {
        logger.debug(`Modifying project setting: [${section}] ${key}`);

        const result = await runOperation(
          ctx,
          project_path,
          'modify_project_setting',
          { section, key, value, action },
        );

        if (!result.ok) {
          return toolError(`Failed to modify project setting: ${result.error}`, [
            'Verify the project path is accessible',
            'Check that Godot is installed and GODOT_PATH is set',
          ]);
        }

        return textResult(JSON.stringify(result.data ?? {}, null, 2));
      },
    ),
  );
}
