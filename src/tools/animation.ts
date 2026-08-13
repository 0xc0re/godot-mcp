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
import type { ServerContext } from '../types.js';
import { resolveWithinProject, runOperation } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, outsideProjectError, opSuccess } from './common.js';

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
    withProject(
      {
        catchPrefix: 'Failed to create animation',
        extraPaths: (a) => [a.output_path],
      },
      async ({ project_path, output_path, length, loop_mode, step, tracks }) => {
        if (resolveWithinProject(project_path, output_path) === null) {
          return outsideProjectError('output_path');
        }

        const params: Record<string, unknown> = {
          outputPath: output_path,
          tracks,
        };

        if (length !== undefined) params.length = length;
        if (loop_mode !== undefined) params.loopMode = loop_mode;
        if (step !== undefined) params.step = step;

        const result = await runOperation(ctx, project_path, 'create_animation', params);

        if (!result.ok) {
          return toolError(`Failed to create animation: ${result.error}`, [
            'Check that the output path is valid',
            'Verify track paths reference existing node properties',
          ]);
        }

        return opSuccess(`Animation created at '${output_path}'`, result.data);
      },
    ),
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
    withProject(
      {
        catchPrefix: 'Failed to create animation library',
        extraPaths: (a) => [a.output_path],
      },
      async ({ project_path, output_path, animations }) => {
        if (resolveWithinProject(project_path, output_path) === null) {
          return outsideProjectError('output_path');
        }

        const params = {
          outputPath: output_path,
          animations,
        };

        const result = await runOperation(ctx, project_path, 'create_animation_library', params);

        if (!result.ok) {
          return toolError(`Failed to create animation library: ${result.error}`, [
            'Check that the output path is valid',
            'Verify animation .tres paths are correct',
          ]);
        }

        return opSuccess(`Animation library created at '${output_path}'`, result.data);
      },
    ),
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
    withProject(
      {
        catchPrefix: 'Failed to add keyframes',
        extraPaths: (a) => [a.animation_path],
      },
      async ({ project_path, animation_path, track_index, track_path, keyframes }) => {
        if (resolveWithinProject(project_path, animation_path) === null) {
          return outsideProjectError('animation_path');
        }

        const params: Record<string, unknown> = {
          animationPath: animation_path,
          keyframes,
        };

        if (track_index !== undefined) params.trackIndex = track_index;
        if (track_path !== undefined) params.trackPath = track_path;

        const result = await runOperation(ctx, project_path, 'add_keyframes', params);

        if (!result.ok) {
          return toolError(`Failed to add keyframes: ${result.error}`, [
            'Check that the animation file exists',
            'Verify the track index or path is valid',
          ]);
        }

        return opSuccess(`Keyframes added to '${animation_path}'`, result.data);
      },
    ),
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
    withProject(
      {
        catchPrefix: 'Failed to assign animation library',
        extraPaths: (a) => [a.scene_path, a.library_path],
      },
      async ({ project_path, scene_path, node_path, library_name, library_path }) => {
        if (resolveWithinProject(project_path, scene_path) === null) {
          return outsideProjectError('scene_path');
        }

        if (resolveWithinProject(project_path, library_path) === null) {
          return outsideProjectError('library_path');
        }

        const params = {
          scenePath: scene_path,
          nodePath: node_path,
          libraryName: library_name,
          libraryPath: library_path,
        };

        const result = await runOperation(ctx, project_path, 'assign_animation_library', params);

        if (!result.ok) {
          return toolError(`Failed to assign animation library: ${result.error}`, [
            'Check that the scene and library files exist',
            'Verify the node path points to an AnimationPlayer node',
          ]);
        }

        return opSuccess(
          `Animation library '${library_name}' assigned to '${node_path}' in '${scene_path}'`,
          result.data,
        );
      },
    ),
  );
}
