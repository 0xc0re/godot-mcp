/**
 * Tilemap tool domain: create_tileset, paint_tilemap.
 *
 * Exposes the GDScript backend operations (from godot_operations.gd) as
 * callable MCP tools with Zod validation, path safety, and structured
 * error responses. Supports TileSet atlas configuration and TileMapLayer
 * painting with paint, fill, and clear modes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../types.js';
import { resolveWithinProject, runOperation } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, outsideProjectError, opSuccess } from './common.js';

export function registerTileMapTools(server: McpServer, ctx: ServerContext): void {
  // Tool: create_tileset
  server.registerTool(
    'create_tileset',
    {
      title: 'Create TileSet',
      description:
        'Create a TileSet resource with an atlas source from a texture image. The atlas source is configured with tile size, separation, margins, and optional grid dimensions.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        output_path: z
          .string()
          .describe("Output path for the .tres file relative to project (e.g., 'tilesets/ground.tres')"),
        texture_path: z
          .string()
          .describe("Path to the texture image relative to project (e.g., 'textures/ground.png')"),
        tile_width: z.number().optional().describe('Width of each tile in pixels (default: 16)'),
        tile_height: z.number().optional().describe('Height of each tile in pixels (default: 16)'),
        separation_x: z
          .number()
          .optional()
          .describe('Horizontal separation between tiles in pixels (default: 0)'),
        separation_y: z
          .number()
          .optional()
          .describe('Vertical separation between tiles in pixels (default: 0)'),
        margin_x: z.number().optional().describe('Horizontal margin in pixels (default: 0)'),
        margin_y: z.number().optional().describe('Vertical margin in pixels (default: 0)'),
        columns: z.number().optional().describe('Number of columns in the atlas (auto-calculated if omitted)'),
        rows: z.number().optional().describe('Number of rows in the atlas (auto-calculated if omitted)'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to create tileset',
        extraPaths: (a) => [a.output_path, a.texture_path],
      },
      async ({
        project_path,
        output_path,
        texture_path,
        tile_width,
        tile_height,
        separation_x,
        separation_y,
        margin_x,
        margin_y,
        columns,
        rows,
      }) => {
        if (resolveWithinProject(project_path, output_path as string) === null) {
          return outsideProjectError('output_path');
        }

        if (resolveWithinProject(project_path, texture_path as string) === null) {
          return outsideProjectError('texture_path');
        }

        const params: Record<string, unknown> = {
          outputPath: output_path,
          texturePath: texture_path,
          tileWidth: (tile_width as number | undefined) ?? 16,
          tileHeight: (tile_height as number | undefined) ?? 16,
          separationX: (separation_x as number | undefined) ?? 0,
          separationY: (separation_y as number | undefined) ?? 0,
          marginX: (margin_x as number | undefined) ?? 0,
          marginY: (margin_y as number | undefined) ?? 0,
        };

        if (columns !== undefined) {
          params.columns = columns;
        }
        if (rows !== undefined) {
          params.rows = rows;
        }

        const result = await runOperation(ctx, project_path, 'create_tileset', params);

        if (!result.ok) {
          return toolError(`Failed to create tileset: ${result.error}`, [
            'Check that the texture file exists at the specified path',
            'Verify tile dimensions are valid positive numbers',
            'Ensure the output directory exists',
          ]);
        }

        return opSuccess(`TileSet created at '${output_path}'`, result.data);
      },
    ),
  );

  // Tool: paint_tilemap
  server.registerTool(
    'paint_tilemap',
    {
      title: 'Paint TileMap',
      description:
        'Paint, fill, or clear cells on a TileMapLayer node. Supports three modes: "paint" for individual cells, "fill" for rectangular regions, and "clear" for removing tiles (specific cells or all).',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe("Path to scene file relative to project (e.g., 'scenes/level.tscn')"),
        node_path: z
          .string()
          .describe("Path to the TileMapLayer node (e.g., 'root/TileMapLayer')"),
        mode: z
          .enum(['paint', 'fill', 'clear'])
          .describe('Paint mode: "paint" for individual cells, "fill" for rectangular region, "clear" to remove tiles'),
        cells: z
          .array(z.object({}).passthrough())
          .optional()
          .describe('Array of cell objects for paint mode ({x, y, source_id, atlas_x, atlas_y}) or clear mode ({x, y})'),
        x_start: z.number().optional().describe('Start X coordinate for fill mode'),
        y_start: z.number().optional().describe('Start Y coordinate for fill mode'),
        x_end: z.number().optional().describe('End X coordinate for fill mode'),
        y_end: z.number().optional().describe('End Y coordinate for fill mode'),
        source_id: z.number().optional().describe('TileSet source ID (default: 0)'),
        atlas_x: z.number().optional().describe('Atlas X coordinate (default: 0)'),
        atlas_y: z.number().optional().describe('Atlas Y coordinate (default: 0)'),
        alternative_tile: z.number().optional().describe('Alternative tile ID (default: 0)'),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to paint tilemap',
        extraPaths: (a) => [a.scene_path],
      },
      async ({
        project_path,
        scene_path,
        node_path,
        mode,
        cells,
        x_start,
        y_start,
        x_end,
        y_end,
        source_id,
        atlas_x,
        atlas_y,
        alternative_tile,
      }) => {
        if (resolveWithinProject(project_path, scene_path as string) === null) {
          return outsideProjectError('scene_path');
        }

        const params: Record<string, unknown> = {
          scenePath: scene_path,
          nodePath: node_path,
          mode,
        };

        if (mode === 'paint') {
          if (cells) {
            params.cells = cells;
          }
        } else if (mode === 'fill') {
          params.xStart = x_start;
          params.yStart = y_start;
          params.xEnd = x_end;
          params.yEnd = y_end;
          params.sourceId = (source_id as number | undefined) ?? 0;
          params.atlasX = (atlas_x as number | undefined) ?? 0;
          params.atlasY = (atlas_y as number | undefined) ?? 0;
          params.alternativeTile = (alternative_tile as number | undefined) ?? 0;
        } else if (mode === 'clear') {
          if (cells) {
            params.cells = cells;
          }
        }

        const result = await runOperation(ctx, project_path, 'paint_tilemap', params);

        if (!result.ok) {
          return toolError(`Failed to paint tilemap: ${result.error}`, [
            'Check that the TileMapLayer node exists in the scene',
            'Verify the TileMapLayer has a TileSet assigned',
            'Ensure cell coordinates and source IDs are valid',
          ]);
        }

        return opSuccess(`TileMap ${mode} operation completed on '${node_path}'`, result.data);
      },
    ),
  );
}
