/**
 * Scene tool domain: create_scene, add_node, load_sprite, export_mesh_library, save_scene
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { executeOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

export function registerSceneTools(server: McpServer, ctx: ServerContext): void {
  // Tool 8: create_scene
  server.registerTool(
    'create_scene',
    {
      title: 'Create Scene',
      description: 'Create a new Godot scene file',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe('Path where the scene file will be saved (relative to project)'),
        root_node_type: z
          .string()
          .optional()
          .describe('Type of the root node (e.g., Node2D, Node3D)'),
      },
    },
    async ({ project_path, scene_path, root_node_type }) => {
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
          rootNodeType: root_node_type || 'Node2D',
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'create_scene',
          params,
        );

        if (stderr && stderr.includes('Failed to')) {
          return toolError(`Failed to create scene: ${stderr}`, [
            'Check if the root node type is valid',
            'Ensure you have write permissions to the scene path',
            'Verify the scene path is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Scene created successfully at: ${scene_path}\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to create scene: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 9: add_node
  server.registerTool(
    'add_node',
    {
      title: 'Add Node',
      description: 'Add a node to an existing scene',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to the scene file (relative to project)'),
        parent_node_path: z
          .string()
          .optional()
          .describe('Path to the parent node (e.g., "root" or "root/Player")'),
        node_type: z
          .string()
          .describe('Type of node to add (e.g., Sprite2D, CollisionShape2D)'),
        node_name: z.string().describe('Name for the new node'),
        properties: z
          .record(z.any())
          .optional()
          .describe('Optional properties to set on the node'),
      },
    },
    async ({
      project_path,
      scene_path,
      parent_node_path,
      node_type,
      node_name,
      properties,
    }) => {
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

        const scenePath = join(project_path, scene_path);
        if (!existsSync(scenePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const params: Record<string, unknown> = {
          scenePath: scene_path,
          nodeType: node_type,
          nodeName: node_name,
        };

        if (parent_node_path) {
          params.parentNodePath = parent_node_path;
        }
        if (properties) {
          params.properties = properties;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'add_node',
          params,
        );

        if (stderr && stderr.includes('Failed to')) {
          return toolError(`Failed to add node: ${stderr}`, [
            'Check if the node type is valid',
            'Ensure the parent node path exists',
            'Verify the scene file is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Node '${node_name}' of type '${node_type}' added successfully to '${scene_path}'.\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to add node: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 10: load_sprite
  server.registerTool(
    'load_sprite',
    {
      title: 'Load Sprite',
      description: 'Load a sprite into a Sprite2D node',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to the scene file (relative to project)'),
        node_path: z
          .string()
          .describe('Path to the Sprite2D node (e.g., "root/Player/Sprite2D")'),
        texture_path: z
          .string()
          .describe('Path to the texture file (relative to project)'),
      },
    },
    async ({ project_path, scene_path, node_path, texture_path }) => {
      if (
        !validatePath(project_path) ||
        !validatePath(scene_path) ||
        !validatePath(node_path) ||
        !validatePath(texture_path)
      ) {
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

        const sceneFilePath = join(project_path, scene_path);
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const textureFilePath = join(project_path, texture_path);
        if (!existsSync(textureFilePath)) {
          return toolError(`Texture file does not exist: ${texture_path}`, [
            'Ensure the texture path is correct',
            'Upload or create the texture file first',
          ]);
        }

        const params = {
          scenePath: scene_path,
          nodePath: node_path,
          texturePath: texture_path,
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'load_sprite',
          params,
        );

        if (stderr && stderr.includes('Failed to')) {
          return toolError(`Failed to load sprite: ${stderr}`, [
            'Check if the node path is correct',
            'Ensure the node is a Sprite2D, Sprite3D, or TextureRect',
            'Verify the texture file is a valid image format',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Sprite loaded successfully with texture: ${texture_path}\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to load sprite: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 11: export_mesh_library
  server.registerTool(
    'export_mesh_library',
    {
      title: 'Export Mesh Library',
      description: 'Export a scene as a MeshLibrary resource',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to the scene file (.tscn) to export'),
        output_path: z
          .string()
          .describe('Path where the mesh library (.res) will be saved'),
        mesh_item_names: z
          .array(z.string())
          .optional()
          .describe(
            'Optional: Names of specific mesh items to include (defaults to all)',
          ),
      },
    },
    async ({ project_path, scene_path, output_path, mesh_item_names }) => {
      if (
        !validatePath(project_path) ||
        !validatePath(scene_path) ||
        !validatePath(output_path)
      ) {
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

        const sceneFilePath = join(project_path, scene_path);
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const params: Record<string, unknown> = {
          scenePath: scene_path,
          outputPath: output_path,
        };

        if (mesh_item_names && Array.isArray(mesh_item_names)) {
          params.meshItemNames = mesh_item_names;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'export_mesh_library',
          params,
        );

        if (stderr && stderr.includes('Failed to')) {
          return toolError(`Failed to export mesh library: ${stderr}`, [
            'Check if the scene contains valid 3D meshes',
            'Ensure the output path is valid',
            'Verify the scene file is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `MeshLibrary exported successfully to: ${output_path}\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to export mesh library: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 12: save_scene
  server.registerTool(
    'save_scene',
    {
      title: 'Save Scene',
      description: 'Save changes to a scene file',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z.string().describe('Path to the scene file (relative to project)'),
        new_path: z
          .string()
          .optional()
          .describe(
            'Optional: New path to save the scene to (for creating variants)',
          ),
      },
    },
    async ({ project_path, scene_path, new_path }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      if (new_path && !validatePath(new_path)) {
        return toolError('Invalid new path', [
          'Provide a valid new path without ".." or other potentially unsafe characters',
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

        const sceneFilePath = join(project_path, scene_path);
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const params: Record<string, unknown> = {
          scenePath: scene_path,
        };

        if (new_path) {
          params.newPath = new_path;
        }

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path,
          'save_scene',
          params,
        );

        if (stderr && stderr.includes('Failed to')) {
          return toolError(`Failed to save scene: ${stderr}`, [
            'Check if the scene file is valid',
            'Ensure you have write permissions to the output path',
            'Verify the scene can be properly packed',
          ]);
        }

        const savePath = new_path || scene_path;
        return {
          content: [
            {
              type: 'text' as const,
              text: `Scene saved successfully to: ${savePath}\n\nOutput: ${stdout}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to save scene: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
