/**
 * Animation tool domain: create_animation, create_animation_library,
 * add_keyframes, assign_animation_library.
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

export function registerAnimationTools(server: McpServer, ctx: ServerContext): void {
  // Tool: create_animation
  server.registerTool(
    'create_animation',
    {
      title: 'Create Animation',
      description:
        'Create an Animation resource with value tracks containing time+value keyframes. Saves as a .tres file that can be added to an AnimationLibrary.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        output_path: z
          .string()
          .describe("Output path for the .tres file relative to project (e.g., 'animations/walk.tres')"),
        length: z.number().optional().describe('Animation length in seconds (default: 1.0)'),
        loop_mode: z
          .enum(['none', 'linear', 'pingpong'])
          .optional()
          .describe("Loop mode: 'none', 'linear', or 'pingpong' (default: 'none')"),
        step: z.number().optional().describe('Time step for the animation editor (default: 0.1)'),
        tracks: z
          .array(
            z.object({
              path: z.string().describe("Node property path (e.g., 'Sprite2D:position')"),
              keyframes: z.array(
                z.object({
                  time: z.number().describe('Keyframe time in seconds'),
                  value: z.unknown().describe('Keyframe value'),
                  type: z.string().optional().describe('Value type hint (e.g., Vector2, Color)'),
                }),
              ),
            }),
          )
          .describe('Array of tracks, each with a property path and keyframes'),
      },
    },
    async ({ project_path, output_path, length, loop_mode, step, tracks }) => {
      if (
        !validatePath(project_path as string) ||
        !validatePath(output_path as string)
      ) {
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

        const params: Record<string, unknown> = {
          outputPath: output_path,
          tracks,
        };

        if (length !== undefined) params.length = length;
        if (loop_mode !== undefined) params.loopMode = loop_mode;
        if (step !== undefined) params.step = step;

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'create_animation',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to create animation: ${stderr}`, [
            'Check that the output path is valid',
            'Verify track paths reference existing node properties',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: stdout,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to create animation: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: create_animation_library
  server.registerTool(
    'create_animation_library',
    {
      title: 'Create Animation Library',
      description:
        'Create an AnimationLibrary resource wrapping named animations. Saves as a .tres file that can be assigned to an AnimationPlayer node.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        output_path: z
          .string()
          .describe("Output path for the .tres file relative to project (e.g., 'animations/library.tres')"),
        animations: z
          .record(z.string(), z.string())
          .describe('Map of animation names to .tres file paths (e.g., {"walk": "animations/walk.tres"})'),
      },
    },
    async ({ project_path, output_path, animations }) => {
      if (
        !validatePath(project_path as string) ||
        !validatePath(output_path as string)
      ) {
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
          outputPath: output_path,
          animations,
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'create_animation_library',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to create animation library: ${stderr}`, [
            'Check that the output path is valid',
            'Verify animation .tres paths are correct',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: stdout,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to create animation library: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: add_keyframes
  server.registerTool(
    'add_keyframes',
    {
      title: 'Add Keyframes',
      description:
        'Add keyframes to an existing animation track. Identify the track by index or property path. Keyframes are inserted at the specified times.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        animation_path: z
          .string()
          .describe("Path to the animation .tres file relative to project (e.g., 'animations/walk.tres')"),
        track_index: z.number().optional().describe('Index of the track to add keyframes to'),
        track_path: z
          .string()
          .optional()
          .describe("Property path of the track (e.g., 'Sprite2D:position') as alternative to track_index"),
        keyframes: z
          .array(
            z.object({
              time: z.number().describe('Keyframe time in seconds'),
              value: z.unknown().describe('Keyframe value'),
              type: z.string().optional().describe('Value type hint (e.g., Vector2, Color)'),
            }),
          )
          .describe('Array of keyframes to add'),
      },
    },
    async ({ project_path, animation_path, track_index, track_path, keyframes }) => {
      if (
        !validatePath(project_path as string) ||
        !validatePath(animation_path as string)
      ) {
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

        const params: Record<string, unknown> = {
          animationPath: animation_path,
          keyframes,
        };

        if (track_index !== undefined) params.trackIndex = track_index;
        if (track_path !== undefined) params.trackPath = track_path;

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'add_keyframes',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to add keyframes: ${stderr}`, [
            'Check that the animation file exists',
            'Verify the track index or path is valid',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: stdout,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to add keyframes: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );

  // Tool: assign_animation_library
  server.registerTool(
    'assign_animation_library',
    {
      title: 'Assign Animation Library',
      description:
        'Assign an AnimationLibrary resource to an AnimationPlayer node in a scene. The library is loaded and added under the given name.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe("Path to the scene file relative to project (e.g., 'scenes/player.tscn')"),
        node_path: z
          .string()
          .describe("Path to the AnimationPlayer node in the scene (e.g., 'root/AnimationPlayer')"),
        library_name: z
          .string()
          .describe("Name for the library in the AnimationPlayer (e.g., 'default')"),
        library_path: z
          .string()
          .describe("Path to the AnimationLibrary .tres file (e.g., 'animations/library.tres')"),
      },
    },
    async ({ project_path, scene_path, node_path, library_name, library_path }) => {
      if (
        !validatePath(project_path as string) ||
        !validatePath(scene_path as string) ||
        !validatePath(library_path as string)
      ) {
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
          scenePath: scene_path,
          nodePath: node_path,
          libraryName: library_name,
          libraryPath: library_path,
        };

        const { stdout, stderr } = await executeOperation(
          ctx,
          project_path as string,
          'assign_animation_library',
          params,
        );

        if (stderr && (stderr.includes('Failed to') || stderr.includes('[ERROR]'))) {
          return toolError(`Failed to assign animation library: ${stderr}`, [
            'Check that the scene and library files exist',
            'Verify the node path points to an AnimationPlayer node',
          ]);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: stdout,
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to assign animation library: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]);
      }
    },
  );
}
