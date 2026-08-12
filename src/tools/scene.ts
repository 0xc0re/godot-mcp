/**
 * Scene tool domain: create_scene, add_node, load_sprite, export_mesh_library, save_scene,
 * read_scene, modify_node_property, remove_node, attach_script
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { ServerContext } from '../types.js';
import { runOperation, validatePath } from '../godot.js';
import { toolError } from '../errors.js';
import { parseScene } from '../parsers/tscn-parser.js';
import { addNodeToScene } from '../parsers/tscn-writer.js';

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

        const result = await runOperation(ctx, project_path, 'create_scene', params);

        if (!result.ok) {
          return toolError(`Failed to create scene: ${result.error}`, [
            'Check if the root node type is valid',
            'Ensure you have write permissions to the scene path',
            'Verify the scene path is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Scene created successfully at: ${scene_path}\n\nOutput: ${JSON.stringify(result.data)}`,
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

        // TypeScript-native .tscn manipulation -- avoids GDScript execution
        // so scenes with autoload-referencing scripts are never corrupted.
        const content = readFileSync(scenePath, 'utf-8');
        const newContent = addNodeToScene(content, {
          parentNodePath: parent_node_path,
          nodeType: node_type,
          nodeName: node_name,
          properties,
        });
        writeFileSync(scenePath, newContent, 'utf-8');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Node '${node_name}' of type '${node_type}' added successfully to '${scene_path}'.`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to add node: ${errorMessage}`, [
          'Ensure the scene file is a valid .tscn file',
          'Check that the node type and name are valid',
          'Verify the scene file is not corrupted',
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

        const result = await runOperation(ctx, project_path, 'load_sprite', params);

        if (!result.ok) {
          return toolError(`Failed to load sprite: ${result.error}`, [
            'Check if the node path is correct',
            'Ensure the node is a Sprite2D, Sprite3D, or TextureRect',
            'Verify the texture file is a valid image format',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Sprite loaded successfully with texture: ${texture_path}\n\nOutput: ${JSON.stringify(result.data)}`,
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

        const result = await runOperation(ctx, project_path, 'export_mesh_library', params);

        if (!result.ok) {
          return toolError(`Failed to export mesh library: ${result.error}`, [
            'Check if the scene contains valid 3D meshes',
            'Ensure the output path is valid',
            'Verify the scene file is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `MeshLibrary exported successfully to: ${output_path}\n\nOutput: ${JSON.stringify(result.data)}`,
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

        const result = await runOperation(ctx, project_path, 'save_scene', params);

        if (!result.ok) {
          return toolError(`Failed to save scene: ${result.error}`, [
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
              text: `Scene saved successfully to: ${savePath}\n\nOutput: ${JSON.stringify(result.data)}`,
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

  // Tool 13: read_scene
  server.registerTool(
    'read_scene',
    {
      title: 'Read Scene',
      description:
        'Read a Godot scene file and return its node hierarchy, resources, and connections as structured JSON',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe(
            'Path to the scene file relative to project (e.g. "scenes/main.tscn")',
          ),
      },
    },
    async ({ project_path, scene_path }) => {
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

        const sceneFilePath = join(project_path, scene_path);
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const content = readFileSync(sceneFilePath, 'utf-8');
        const parsed = parseScene(content);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(parsed, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to read scene: ${errorMessage}`, [
          'Ensure the scene file is a valid .tscn file',
          'Check if the file is not corrupted',
          'Verify the scene path is correct',
        ]);
      }
    },
  );

  // Tool 14: modify_node_property
  server.registerTool(
    'modify_node_property',
    {
      title: 'Modify Node Property',
      description:
        'Modify a property on a node in a Godot scene (position, scale, visibility, custom properties)',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe('Path to the scene file relative to project'),
        node_path: z
          .string()
          .describe(
            'Path to the target node (e.g. "root/Player" or "root/Player/Sprite2D")',
          ),
        property_name: z
          .string()
          .describe(
            'Name of the property to modify (e.g. "position", "scale", "visible")',
          ),
        value: z
          .any()
          .describe(
            'New value for the property (JSON object for Vector2/Vector3/Color, primitive for others)',
          ),
        value_type: z
          .string()
          .optional()
          .describe(
            'Type hint for complex values: "Vector2", "Vector3", "Color", "bool", "int", "float". Omit for strings.',
          ),
      },
    },
    async ({
      project_path,
      scene_path,
      node_path,
      property_name,
      value,
      value_type,
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

        const sceneFilePath = join(project_path, scene_path);
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const params = {
          scenePath: scene_path,
          nodePath: node_path,
          propertyName: property_name,
          value,
          valueType: value_type || '',
        };

        const result = await runOperation(ctx, project_path, 'modify_node_property', params);

        if (!result.ok) {
          return toolError(`Failed to modify node property: ${result.error}`, [
            'Check if the node path exists in the scene',
            'Verify the property name is valid for this node type',
            'Ensure the value type matches the property type',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Property '${property_name}' modified on node '${node_path}'\n\nOutput: ${JSON.stringify(result.data)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to modify node property: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 15: remove_node
  server.registerTool(
    'remove_node',
    {
      title: 'Remove Node',
      description: 'Remove a node from a Godot scene by its path',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe('Path to the scene file relative to project'),
        node_path: z
          .string()
          .describe(
            'Path to the node to remove (e.g. "root/EnemySpawner")',
          ),
      },
    },
    async ({ project_path, scene_path, node_path }) => {
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

        const sceneFilePath = join(project_path, scene_path);
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const params = {
          scenePath: scene_path,
          nodePath: node_path,
        };

        const result = await runOperation(ctx, project_path, 'remove_node', params);

        if (!result.ok) {
          return toolError(`Failed to remove node: ${result.error}`, [
            'Check if the node path exists in the scene',
            'The root node cannot be removed',
            'Verify the scene file is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Node '${node_path}' removed successfully\n\nOutput: ${JSON.stringify(result.data)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to remove node: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool 16: attach_script
  server.registerTool(
    'attach_script',
    {
      title: 'Attach Script',
      description: 'Attach a GDScript file to a node in a Godot scene',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe('Path to the scene file relative to project'),
        node_path: z
          .string()
          .describe('Path to the target node (e.g. "root/Player")'),
        script_path: z
          .string()
          .describe(
            'Path to the GDScript file relative to project (e.g. "scripts/player.gd")',
          ),
      },
    },
    async ({ project_path, scene_path, node_path, script_path }) => {
      if (
        !validatePath(project_path) ||
        !validatePath(scene_path) ||
        !validatePath(script_path)
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

        const params = {
          scenePath: scene_path,
          nodePath: node_path,
          scriptPath: script_path,
        };

        const result = await runOperation(ctx, project_path, 'attach_script', params);

        if (!result.ok) {
          return toolError(`Failed to attach script: ${result.error}`, [
            'Check if the node path exists in the scene',
            'Ensure the script file exists and is valid GDScript',
            'Verify the script path is correct',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Script '${script_path}' attached to node '${node_path}'\n\nOutput: ${JSON.stringify(result.data)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to attach script: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
