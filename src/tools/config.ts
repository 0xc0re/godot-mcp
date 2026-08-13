/**
 * Project configuration tool domain: input actions, collision layers, autoloads.
 *
 * Exposes GDScript backend operations for input action management,
 * collision layer naming/bitmask resolution, and autoload singleton
 * registration. Uses project.godot parsing for read operations.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { resolveWithinProject, runOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';
import { parseProjectSettings } from '../parsers/project-parser.js';

export function registerConfigTools(server: McpServer, ctx: ServerContext): void {
  // Tool: add_input_action
  server.registerTool(
    'add_input_action',
    {
      title: 'Add Input Action',
      description:
        'Add an input action with one or more event bindings to the Godot project. Supports keyboard keys, joypad buttons, and joypad axes. The action is written to project.godot via ProjectSettings.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        action_name: z.string().describe("Name of the input action (e.g., 'jump', 'move_left')"),
        events: z
          .array(
            z.object({
              type: z
                .enum(['key', 'joypad_button', 'joypad_motion'])
                .describe('Type of input event'),
              key: z
                .string()
                .optional()
                .describe("Human-readable key name for key events (e.g., 'space', 'w')"),
              physical_keycode: z
                .number()
                .optional()
                .describe('Physical keycode for key events'),
              keycode: z.number().optional().describe('Keycode for key events'),
              button_index: z
                .number()
                .optional()
                .describe('Button index for joypad_button events'),
              axis: z.number().optional().describe('Axis index for joypad_motion events'),
              axis_value: z
                .number()
                .optional()
                .describe('Axis value for joypad_motion events (e.g., 1.0 or -1.0)'),
            }),
          )
          .min(1)
          .describe('Array of input event bindings'),
        deadzone: z
          .number()
          .optional()
          .default(0.5)
          .describe('Deadzone for the input action (default: 0.5)'),
      },
    },
    async ({ project_path, action_name, events, deadzone }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const params = {
          actionName: action_name,
          events,
          deadzone: deadzone ?? 0.5,
        };

        const result = await runOperation(ctx, project_path as string, 'add_input_action', params);

        if (!result.ok) {
          return toolError(`Failed to add input action: ${result.error}`, [
            'Check that the action name is valid',
            'Verify event types and parameters are correct',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Input action '${action_name}' added successfully\n\nOutput: ${JSON.stringify(result.data)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to add input action: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: remove_input_action
  server.registerTool(
    'remove_input_action',
    {
      title: 'Remove Input Action',
      description:
        'Remove an input action and all its event bindings from the Godot project. The action is removed from project.godot via ProjectSettings.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        action_name: z.string().describe("Name of the input action to remove (e.g., 'jump')"),
      },
    },
    async ({ project_path, action_name }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const params = {
          actionName: action_name,
        };

        const result = await runOperation(
          ctx,
          project_path as string,
          'remove_input_action',
          params,
        );

        if (!result.ok) {
          return toolError(`Failed to remove input action: ${result.error}`, [
            'Check that the action name exists in the project',
            'Use list_input_actions to see current actions',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Input action '${action_name}' removed successfully\n\nOutput: ${JSON.stringify(result.data)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to remove input action: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: list_input_actions
  server.registerTool(
    'list_input_actions',
    {
      title: 'List Input Actions',
      description:
        'List all configured input actions and their event bindings from the Godot project. Reads and parses project.godot directly for fast results.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
      },
    },
    async ({ project_path }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const content = readFileSync(projectFile, 'utf-8');
        const parsed = parseProjectSettings(content);

        const inputSection = parsed.sections['input'] || {};
        const actions = Object.entries(inputSection).map(([name, rawValue]) => ({
          name,
          raw_value: rawValue,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ actions }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to list input actions: ${errorMessage}`, [
          'Ensure the project.godot file is readable',
          'Check if the project path is correct',
        ]);
      }
    },
  );

  // ── Collision Layer Management ───────────────────────────────────────

  // Tool: get_collision_layer_names
  server.registerTool(
    'get_collision_layer_names',
    {
      title: 'Get Collision Layer Names',
      description:
        'Get named collision layers from project.godot. Returns a mapping of layer numbers to names for the specified physics type. Reads project.godot directly for fast results.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        physics_type: z
          .enum(['2d', '3d'])
          .optional()
          .default('3d')
          .describe('Physics type: "2d" or "3d" (default: "3d")'),
      },
    },
    async ({ project_path, physics_type }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const content = readFileSync(projectFile, 'utf-8');
        const parsed = parseProjectSettings(content);
        const layerSection = parsed.sections['layer_names'] || {};
        const prefix = `${physics_type as string}_physics/layer_`;

        const layers: Record<string, string> = {};
        for (const [key, value] of Object.entries(layerSection)) {
          if (key.startsWith(prefix)) {
            const layerNum = key.substring(prefix.length);
            layers[layerNum] = value.replace(/^"|"$/g, '');
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ physics_type, layers }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to get collision layer names: ${errorMessage}`, [
          'Ensure the project.godot file is readable',
          'Check if the project path is correct',
        ]);
      }
    },
  );

  // Tool: set_collision_layer_names
  server.registerTool(
    'set_collision_layer_names',
    {
      title: 'Set Collision Layer Names',
      description:
        'Name collision layers in project.godot. Accepts a mapping of layer numbers (1-32) to human-readable names. Uses Godot ConfigFile API to persist changes.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        physics_type: z
          .enum(['2d', '3d'])
          .optional()
          .default('3d')
          .describe('Physics type: "2d" or "3d" (default: "3d")'),
        layers: z
          .array(
            z.object({
              layer: z.number().min(1).max(32).describe('Layer number (1-32)'),
              name: z.string().describe('Human-readable name (e.g., "Player", "Environment")'),
            }),
          )
          .min(1)
          .describe('Array of layer number to name mappings'),
      },
    },
    async ({ project_path, physics_type, layers }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const typedLayers = layers as Array<{ layer: number; name: string }>;
        const results: Array<{ layer: number; name: string; success: boolean }> = [];

        for (const { layer, name } of typedLayers) {
          const key = `${physics_type as string}_physics/layer_${layer}`;
          const result = await runOperation(
            ctx,
            project_path as string,
            'modify_project_setting',
            { section: 'layer_names', key, value: name, action: 'set' },
          );

          results.push({ layer, name, success: result.ok });
        }

        const allSuccess = results.every((r) => r.success);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: allSuccess,
                physics_type,
                layers_set: results,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to set collision layer names: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]);
      }
    },
  );

  // Tool: set_node_collision
  server.registerTool(
    'set_node_collision',
    {
      title: 'Set Node Collision',
      description:
        'Set collision layer and/or mask on a node using named layers instead of raw bitmasks. ' +
        'Resolves layer names (e.g., "Player", "Environment") to bitmask integers using the ' +
        'layer names configured in project.godot. Avoids error-prone manual bitmask math.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe('Path to the scene file relative to project root (e.g., "scenes/player.tscn")'),
        node_path: z
          .string()
          .describe('Path to the node within the scene (e.g., ".", "Player/CollisionShape3D")'),
        collision_layer: z
          .array(z.string())
          .optional()
          .describe('Layer names for collision_layer (e.g., ["Player"])'),
        collision_mask: z
          .array(z.string())
          .optional()
          .describe('Layer names for collision_mask (e.g., ["Environment", "Enemy"])'),
        physics_type: z
          .enum(['2d', '3d'])
          .optional()
          .default('3d')
          .describe('Physics type for layer name lookup: "2d" or "3d" (default: "3d")'),
      },
    },
    async ({ project_path, scene_path, node_path, collision_layer, collision_mask, physics_type }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        if (!collision_layer && !collision_mask) {
          return toolError('Must specify at least one of collision_layer or collision_mask', [
            'Provide collision_layer and/or collision_mask as arrays of layer names',
          ]);
        }

        if (resolveWithinProject(project_path as string, scene_path as string) === null) {
          return toolError('Invalid scene_path: path resolves outside the project directory', [
            'Use a path relative to the project root',
            'Do not use "..", absolute paths, or symlinks that escape the project',
          ]);
        }

        // Read layer name mappings from project.godot
        const content = readFileSync(projectFile, 'utf-8');
        const parsed = parseProjectSettings(content);
        const layerSection = parsed.sections['layer_names'] || {};
        const prefix = `${physics_type as string}_physics/layer_`;

        const nameToLayer: Map<string, number> = new Map();
        for (const [key, value] of Object.entries(layerSection)) {
          if (key.startsWith(prefix)) {
            const layerNum = parseInt(key.substring(prefix.length), 10);
            const layerName = value.replace(/^"|"$/g, '');
            nameToLayer.set(layerName, layerNum);
          }
        }

        // Resolve names to bitmask
        const resolveBitmask = (names: string[]): { bitmask: number; unresolved: string[] } => {
          let bitmask = 0;
          const unresolved: string[] = [];
          for (const name of names) {
            const layerNum = nameToLayer.get(name);
            if (layerNum !== undefined) {
              bitmask |= 1 << (layerNum - 1);
            } else {
              unresolved.push(name);
            }
          }
          return { bitmask, unresolved };
        };

        const results: Array<{ property: string; bitmask: number; success: boolean }> = [];
        const allUnresolved: string[] = [];

        // Set collision_layer if provided
        if (collision_layer) {
          const typedLayer = collision_layer as string[];
          const { bitmask, unresolved } = resolveBitmask(typedLayer);
          allUnresolved.push(...unresolved);
          if (unresolved.length === 0) {
            const result = await runOperation(
              ctx,
              project_path as string,
              'modify_node_property',
              {
                scenePath: scene_path,
                nodePath: node_path,
                propertyName: 'collision_layer',
                value: bitmask,
              },
            );
            results.push({ property: 'collision_layer', bitmask, success: result.ok });
          }
        }

        // Set collision_mask if provided
        if (collision_mask) {
          const typedMask = collision_mask as string[];
          const { bitmask, unresolved } = resolveBitmask(typedMask);
          allUnresolved.push(...unresolved);
          if (unresolved.length === 0) {
            const result = await runOperation(
              ctx,
              project_path as string,
              'modify_node_property',
              {
                scenePath: scene_path,
                nodePath: node_path,
                propertyName: 'collision_mask',
                value: bitmask,
              },
            );
            results.push({ property: 'collision_mask', bitmask, success: result.ok });
          }
        }

        if (allUnresolved.length > 0) {
          const available = Array.from(nameToLayer.keys()).join(', ');
          return toolError(
            `Unknown layer names: ${allUnresolved.join(', ')}`,
            [
              available ? `Available layers: ${available}` : 'No named layers configured',
              'Use set_collision_layer_names to define layer names first',
              'Use get_collision_layer_names to see current mappings',
            ],
          );
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: results.every((r) => r.success),
                results,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to set node collision: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Verify the scene and node paths are correct',
        ]);
      }
    },
  );

  // ── Autoload Singleton Management ────────────────────────────────────

  // Tool: list_autoloads
  server.registerTool(
    'list_autoloads',
    {
      title: 'List Autoloads',
      description:
        'List all autoload singletons registered in project.godot. Returns name, script path, and enabled status. Reads project.godot directly for fast results.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
      },
    },
    async ({ project_path }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const content = readFileSync(projectFile, 'utf-8');
        const parsed = parseProjectSettings(content);
        const autoloadSection = parsed.sections['autoload'] || {};

        const autoloads = Object.entries(autoloadSection).map(([name, rawValue]) => {
          const value = rawValue.replace(/^"|"$/g, '');
          const enabled = value.startsWith('*');
          const scriptPath = enabled ? value.substring(1) : value;
          return { name, script_path: scriptPath, enabled };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ autoloads }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to list autoloads: ${errorMessage}`, [
          'Ensure the project.godot file is readable',
          'Check if the project path is correct',
        ]);
      }
    },
  );

  // Tool: add_autoload
  server.registerTool(
    'add_autoload',
    {
      title: 'Add Autoload',
      description:
        'Register an autoload singleton in project.godot. Validates the script file exists, ' +
        'adds the "*res://" prefix automatically, and writes to the [autoload] section via ' +
        'Godot ConfigFile API.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        name: z
          .string()
          .describe('Autoload name (PascalCase, e.g., "EventBus", "GameManager")'),
        script_path: z
          .string()
          .describe(
            'Path to the GDScript file relative to project root (e.g., "scripts/autoloads/event_bus.gd")',
          ),
        enabled: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether the autoload is enabled (default: true)'),
      },
    },
    async ({ project_path, name, script_path, enabled }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        // Validate the script file stays inside the project and exists
        const fullScriptPath = resolveWithinProject(project_path as string, script_path as string);
        if (fullScriptPath === null) {
          return toolError('Invalid script_path: path resolves outside the project directory', [
            'Use a path relative to the project root',
            'Do not use "..", absolute paths, or symlinks that escape the project',
          ]);
        }
        if (!existsSync(fullScriptPath)) {
          return toolError(`Script file not found: ${script_path}`, [
            'Ensure the script file exists at the specified path',
            'Paths should be relative to the project root (e.g., "scripts/autoloads/event_bus.gd")',
          ]);
        }

        // Build the autoload value: *res://path for enabled, res://path for disabled.
        // Strip any res:// prefix from the input first (resolveWithinProject accepts it,
        // so the guard above passes for res:// paths) to avoid writing a corrupt
        // "res://res://..." entry into project.godot.
        const scriptPathStr = script_path as string;
        const normalizedScriptPath = scriptPathStr.startsWith('res://')
          ? scriptPathStr.slice('res://'.length)
          : scriptPathStr;
        const prefix = (enabled as boolean) !== false ? '*' : '';
        const resPath = `${prefix}res://${normalizedScriptPath}`;

        const result = await runOperation(
          ctx,
          project_path as string,
          'modify_project_setting',
          { section: 'autoload', key: name, value: resPath, action: 'set' },
        );

        if (!result.ok) {
          return toolError(`Failed to add autoload: ${result.error}`, [
            'Check that the script path is valid',
            'Verify the autoload name is valid (PascalCase recommended)',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                name,
                script_path,
                enabled: (enabled as boolean) !== false,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to add autoload: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]);
      }
    },
  );

  // Tool: remove_autoload
  server.registerTool(
    'remove_autoload',
    {
      title: 'Remove Autoload',
      description:
        'Remove an autoload singleton from project.godot. Deletes the entry from the [autoload] section via Godot ConfigFile API.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        name: z.string().describe('Autoload name to remove (e.g., "EventBus")'),
      },
    },
    async ({ project_path, name }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const result = await runOperation(
          ctx,
          project_path as string,
          'modify_project_setting',
          { section: 'autoload', key: name, action: 'delete' },
        );

        if (!result.ok) {
          return toolError(`Failed to remove autoload: ${result.error}`, [
            'Check that the autoload name exists',
            'Use list_autoloads to see current autoloads',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, name, action: 'removed' }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to remove autoload: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]);
      }
    },
  );
}
