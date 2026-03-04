/**
 * Scene composition tool domain: connect_signal, disconnect_signal,
 * instance_scene, batch_set_properties, manage_groups.
 *
 * Exposes the GDScript backend operations (from godot_operations.gd) as
 * callable MCP tools with Zod validation, path safety, and structured
 * error responses.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

export function registerCompositionTools(server: McpServer, ctx: ServerContext): void {
  // Tool: connect_signal
  server.registerTool(
    'connect_signal',
    {
      title: 'Connect Signal',
      description:
        'Connect a signal between two nodes in a Godot scene. The connection persists in the .tscn file (uses CONNECT_PERSIST). Both nodes must exist in the scene.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe("Path to scene file relative to project (e.g., 'scenes/main.tscn')"),
        source_node_path: z
          .string()
          .describe("Path to the node emitting the signal (e.g., 'root/Button')"),
        signal_name: z
          .string()
          .describe("Name of the signal (e.g., 'pressed', 'body_entered')"),
        target_node_path: z
          .string()
          .describe("Path to the node receiving the signal (e.g., 'root' for scene root)"),
        method_name: z
          .string()
          .describe("Name of the method to call on the target node (e.g., '_on_button_pressed')"),
      },
    },
    async ({ project_path, scene_path, source_node_path, signal_name, target_node_path, method_name }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
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

        const params = {
          scenePath: scene_path,
          sourceNodePath: source_node_path,
          signalName: signal_name,
          targetNodePath: target_node_path,
          methodName: method_name,
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'connect_signal',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to connect signal: ${stderr}`, [
            'Check that both source and target nodes exist in the scene',
            'Verify the signal name is valid for the source node type',
            'Ensure the method name is correct',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Signal '${signal_name}' connected from '${source_node_path}' to '${target_node_path}.${method_name}'\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to connect signal: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: disconnect_signal
  server.registerTool(
    'disconnect_signal',
    {
      title: 'Disconnect Signal',
      description:
        'Disconnect an existing signal connection between two nodes in a Godot scene. The connection must exist.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe("Path to scene file relative to project (e.g., 'scenes/main.tscn')"),
        source_node_path: z
          .string()
          .describe("Path to the node emitting the signal (e.g., 'root/Button')"),
        signal_name: z
          .string()
          .describe("Name of the signal (e.g., 'pressed', 'body_entered')"),
        target_node_path: z
          .string()
          .describe("Path to the node receiving the signal (e.g., 'root' for scene root)"),
        method_name: z
          .string()
          .describe("Name of the method on the target node (e.g., '_on_button_pressed')"),
      },
    },
    async ({ project_path, scene_path, source_node_path, signal_name, target_node_path, method_name }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
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

        const params = {
          scenePath: scene_path,
          sourceNodePath: source_node_path,
          signalName: signal_name,
          targetNodePath: target_node_path,
          methodName: method_name,
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'disconnect_signal',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to disconnect signal: ${stderr}`, [
            'Check that the signal connection exists',
            'Verify the source and target node paths are correct',
            'Ensure the signal and method names match the existing connection',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Signal '${signal_name}' disconnected from '${source_node_path}' to '${target_node_path}.${method_name}'\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to disconnect signal: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: instance_scene
  server.registerTool(
    'instance_scene',
    {
      title: 'Instance Scene',
      description:
        'Add a .tscn scene as an instanced child node in another scene. The instance reference (not inlined nodes) is preserved in the saved .tscn file.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to the parent scene file'),
        child_scene_path: z
          .string()
          .describe('Path to the .tscn scene to instance (relative to project)'),
        parent_node_path: z
          .string()
          .describe("Path to the parent node (e.g., 'root' or 'root/Enemies')"),
        node_name: z
          .string()
          .optional()
          .describe('Optional custom name for the instanced node'),
      },
    },
    async ({ project_path, scene_path, child_scene_path, parent_node_path, node_name }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
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

        const params: Record<string, unknown> = {
          scenePath: scene_path,
          childScenePath: child_scene_path,
          parentNodePath: parent_node_path,
        };

        if (node_name) {
          params.nodeName = node_name;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'instance_scene',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to instance scene: ${stderr}`, [
            'Check that the child scene path is correct and the .tscn file exists',
            'Verify the parent node path exists in the scene',
            'Ensure the child scene is a valid Godot scene file',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Scene '${child_scene_path}' instanced under '${parent_node_path}'\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to instance scene: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: batch_set_properties
  server.registerTool(
    'batch_set_properties',
    {
      title: 'Batch Set Properties',
      description:
        'Set properties on multiple nodes in a single operation. All changes are applied in one Godot subprocess call. All node paths are validated before any changes are applied.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to scene file relative to project'),
        operations: z
          .array(
            z.object({
              node_path: z.string(),
              property_name: z.string(),
              value: z.unknown(),
              value_type: z.string().optional(),
            }),
          )
          .min(1)
          .describe('Array of property operations to apply'),
      },
    },
    async ({ project_path, scene_path, operations }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
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

        // Belt-and-suspenders check (Zod .min(1) should handle this)
        const ops = operations as Array<Record<string, unknown>>;
        if (!ops || ops.length === 0) {
          return toolError('Operations array must not be empty', [
            'Provide at least one property operation',
          ]);
        }

        const params = {
          scenePath: scene_path,
          operations: ops,
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'batch_set_properties',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to set properties: ${stderr}`, [
            'Check that all node paths exist in the scene',
            'Verify property names are valid for each node type',
            'Ensure value types match the property types',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Batch properties set on ${ops.length} operation(s)\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to set properties: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: manage_groups
  server.registerTool(
    'manage_groups',
    {
      title: 'Manage Groups',
      description:
        'Add or remove a node from groups. Group membership persists in the saved .tscn file. At least one of add_groups or remove_groups must be provided.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to scene file relative to project'),
        node_path: z.string().describe('Path to the target node'),
        add_groups: z.array(z.string()).optional().describe('Groups to add the node to'),
        remove_groups: z.array(z.string()).optional().describe('Groups to remove the node from'),
      },
    },
    async ({ project_path, scene_path, node_path, add_groups, remove_groups }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
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

        // Validate at least one group operation is provided
        const addArr = add_groups as string[] | undefined;
        const removeArr = remove_groups as string[] | undefined;
        const hasAdd = addArr && addArr.length > 0;
        const hasRemove = removeArr && removeArr.length > 0;

        if (!hasAdd && !hasRemove) {
          return toolError('At least one of add_groups or remove_groups must be provided', [
            'Provide add_groups to add the node to groups',
            'Provide remove_groups to remove the node from groups',
          ]);
        }

        const params: Record<string, unknown> = {
          scenePath: scene_path,
          nodePath: node_path,
        };

        if (hasAdd) {
          params.addGroups = addArr;
        }
        if (hasRemove) {
          params.removeGroups = removeArr;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'manage_groups',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to manage groups: ${stderr}`, [
            'Check that the node path exists in the scene',
            'Verify the group names are valid strings',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Groups updated for node '${node_path}'\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to manage groups: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
