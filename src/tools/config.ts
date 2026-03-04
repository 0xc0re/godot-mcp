/**
 * Project configuration tool domain: add_input_action, remove_input_action,
 * list_input_actions.
 *
 * Exposes GDScript backend operations for input action management and
 * project.godot parsing for listing configured actions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
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

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'add_input_action',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to add input action: ${stderr}`, [
            'Check that the action name is valid',
            'Verify event types and parameters are correct',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Input action '${action_name}' added successfully\n\nOutput: ${stdout}`,
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

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'remove_input_action',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to remove input action: ${stderr}`, [
            'Check that the action name exists in the project',
            'Use list_input_actions to see current actions',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Input action '${action_name}' removed successfully\n\nOutput: ${stdout}`,
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
}
