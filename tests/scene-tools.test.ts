/**
 * Tests for scene MCP tools: read_scene, add_node, modify_node_property, remove_node, attach_script.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';
import { registerSceneTools } from '../src/tools/scene.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  // Pure-path stand-in for the real resolveWithinProject: rejects null bytes,
  // ".." traversal, and absolute paths; strips res:// and joins to the root.
  resolveWithinProject: vi.fn((projectRoot: string, relPath: string) => {
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) return null;
    const stripped = relPath.startsWith('res://') ? relPath.slice('res://'.length) : relPath;
    if (stripped.startsWith('/') || stripped.split('/').includes('..')) return null;
    return `${projectRoot}/${stripped}`;
  }),
  executeOperation: vi.fn(),
  runOperation: vi.fn(),
}));

// Mock tscn-parser module
vi.mock('../src/parsers/tscn-parser.js', () => ({
  parseScene: vi.fn(),
}));

// Mock tscn-writer module
vi.mock('../src/parsers/tscn-writer.js', () => ({
  addNodeToScene: vi.fn(),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { validatePath, executeOperation, runOperation } from '../src/godot.js';
import { parseScene } from '../src/parsers/tscn-parser.js';
import { addNodeToScene } from '../src/parsers/tscn-writer.js';
import { toolError } from '../src/errors.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(server: McpServer): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  // McpServer stores tools internally; we intercept registerTool calls
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
    return originalRegisterTool(
      name,
      _config as Parameters<typeof originalRegisterTool>[1],
      handler as Parameters<typeof originalRegisterTool>[2],
    );
  } as typeof server.registerTool;

  return handlers;
}

function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
  };
}

// Minimal .tscn content for add_node tests
const MINIMAL_TSCN = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`;

describe('Scene MCP Tools', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    ctx = createTestContext();
    handlers = getToolHandlers(server);
    registerSceneTools(server, ctx);
  });

  describe('read_scene', () => {
    it('registers the read_scene tool', () => {
      expect(handlers.has('read_scene')).toBe(true);
    });

    it('reads file and returns parsed scene JSON', async () => {
      const mockParsed = {
        format: 3,
        extResources: [],
        subResources: [],
        nodes: [{ name: 'root', type: 'Node2D', properties: {} }],
        connections: [],
      };

      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('[gd_scene format=3]');
      vi.mocked(parseScene).mockReturnValue(mockParsed);

      const handler = handlers.get('read_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
      }) as { content: Array<{ type: string; text: string }> };

      expect(readFileSync).toHaveBeenCalled();
      expect(parseScene).toHaveBeenCalledWith('[gd_scene format=3]');
      expect(result.content[0].text).toContain('Node2D');
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('read_scene')!;
      const result = await handler({
        project_path: '/my/../project',
        scene_path: 'scenes/main.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when project.godot missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('read_scene')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('add_node', () => {
    it('registers the add_node tool', () => {
      expect(handlers.has('add_node')).toBe(true);
    });

    it('reads .tscn from disk, calls addNodeToScene, writes result back', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(MINIMAL_TSCN);
      const updatedContent = MINIMAL_TSCN + '\n[node name="NewNode" type="Sprite2D" parent="."]\n';
      vi.mocked(addNodeToScene).mockReturnValue(updatedContent);

      const handler = handlers.get('add_node')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_type: 'Sprite2D',
        node_name: 'NewNode',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      // Should read the .tscn file
      expect(readFileSync).toHaveBeenCalledWith('/my/project/scenes/main.tscn', 'utf-8');
      // Should call addNodeToScene with the content and options
      expect(addNodeToScene).toHaveBeenCalledWith(MINIMAL_TSCN, {
        parentNodePath: undefined,
        nodeType: 'Sprite2D',
        nodeName: 'NewNode',
        properties: undefined,
      });
      // Should write the result back to disk
      expect(writeFileSync).toHaveBeenCalledWith('/my/project/scenes/main.tscn', updatedContent, 'utf-8');
      // Should NOT call executeOperation or runOperation
      expect(executeOperation).not.toHaveBeenCalled();
      expect(runOperation).not.toHaveBeenCalled();
      // Should return success
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('NewNode');
    });

    it('returns success with properties passed to addNodeToScene', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(MINIMAL_TSCN);
      vi.mocked(addNodeToScene).mockReturnValue(MINIMAL_TSCN + '\n[node name="Pos" type="Sprite2D" parent="."]\nposition = Vector2(10, 20)\n');

      const handler = handlers.get('add_node')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_type: 'Sprite2D',
        node_name: 'Pos',
        properties: { position: { x: 10, y: 20 } },
      }) as { isError?: boolean };

      expect(addNodeToScene).toHaveBeenCalledWith(MINIMAL_TSCN, {
        parentNodePath: undefined,
        nodeType: 'Sprite2D',
        nodeName: 'Pos',
        properties: { position: { x: 10, y: 20 } },
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns toolError when scene file does not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).endsWith('project.godot')) return true;
        return false; // scene file doesn't exist
      });

      const handler = handlers.get('add_node')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/missing.tscn',
        node_type: 'Sprite2D',
        node_name: 'Test',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('add_node')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        node_type: 'Sprite2D',
        node_name: 'Test',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when addNodeToScene throws', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid content');
      vi.mocked(addNodeToScene).mockImplementation(() => {
        throw new Error('Invalid .tscn content: missing [gd_scene] header');
      });

      const handler = handlers.get('add_node')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_type: 'Sprite2D',
        node_name: 'Test',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('create_scene', () => {
    it('registers the create_scene tool', () => {
      expect(handlers.has('create_scene')).toBe(true);
    });

    it('passes correct params to runOperation and returns success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, scene_path: 'scenes/new.tscn', root_node_type: 'Node2D' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('create_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/new.tscn',
        root_node_type: 'Node2D',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'create_scene',
        expect.objectContaining({ scenePath: 'scenes/new.tscn', rootNodeType: 'Node2D' }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('scenes/new.tscn');
    });

    it('renders "Output: {}" (not "Output: undefined") when ok:true has no data (ledgered)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('create_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/new.tscn',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Output: {}');
      expect(result.content[0].text).not.toContain('undefined');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to instantiate node of type: BogusType',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('create_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/new.tscn',
        root_node_type: 'BogusType',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to instantiate node of type: BogusType'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('create_scene')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/new.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('load_sprite', () => {
    it('registers the load_sprite tool', () => {
      expect(handlers.has('load_sprite')).toBe(true);
    });

    it('passes correct params to runOperation and returns success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, node_path: 'root/Sprite2D', texture_path: 'res://sprite.png' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('load_sprite')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Sprite2D',
        texture_path: 'sprite.png',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'load_sprite',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Sprite2D',
          texturePath: 'sprite.png',
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Sprite loaded successfully');
      expect(result.content[0].text).toContain('sprite.png');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Node not found: root/Sprite2D',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('load_sprite')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Sprite2D',
        texture_path: 'sprite.png',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Node not found: root/Sprite2D'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('load_sprite')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/../etc',
        texture_path: 'sprite.png',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('export_mesh_library', () => {
    it('registers the export_mesh_library tool', () => {
      expect(handlers.has('export_mesh_library')).toBe(true);
    });

    it('passes correct params to runOperation and returns success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, output_path: 'res://meshes.res', item_count: 3 },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('export_mesh_library')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/meshes.tscn',
        output_path: 'meshes.res',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'export_mesh_library',
        expect.objectContaining({ scenePath: 'scenes/meshes.tscn', outputPath: 'meshes.res' }),
        // Slow-op timeout override (mesh export can exceed the default 30s)
        { timeout: 120_000 },
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('MeshLibrary exported successfully to: meshes.res');
      expect(result.content[0].text).toContain('"item_count": 3');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Scene contains no MeshInstance3D nodes',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('export_mesh_library')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/meshes.tscn',
        output_path: 'meshes.res',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Scene contains no MeshInstance3D nodes'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('export_mesh_library')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/../../etc/passwd',
        output_path: 'meshes.res',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('save_scene', () => {
    it('registers the save_scene tool', () => {
      expect(handlers.has('save_scene')).toBe(true);
    });

    it('passes correct params to runOperation and returns success', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, scene_path: 'scenes/main.tscn' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('save_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'save_scene',
        expect.objectContaining({ scenePath: 'scenes/main.tscn' }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Scene saved successfully to: scenes/main.tscn');
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to save scene: 12',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('save_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save scene: 12'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid new_path', async () => {
      vi.mocked(validatePath).mockImplementation((p) => !String(p).includes('..'));

      const handler = handlers.get('save_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        new_path: '../../etc/passwd',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('modify_node_property', () => {
    it('registers the modify_node_property tool', () => {
      expect(handlers.has('modify_node_property')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, node: 'root/Player', property: 'position', value: '(100, 200)' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('modify_node_property')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        property_name: 'position',
        value: { x: 100, y: 200 },
        value_type: 'Vector2',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'modify_node_property',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          propertyName: 'position',
          value: { x: 100, y: 200 },
          valueType: 'Vector2',
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain(
        "Property 'position' modified on node 'root/Player'",
      );
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Node not found: root/Player',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('modify_node_property')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        property_name: 'position',
        value: { x: 100, y: 200 },
        value_type: 'Vector2',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Node not found: root/Player'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid paths', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('modify_node_property')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        property_name: 'position',
        value: 42,
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('remove_node', () => {
    it('registers the remove_node tool', () => {
      expect(handlers.has('remove_node')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, removed: 'root/EnemySpawner' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('remove_node')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/EnemySpawner',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'remove_node',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/EnemySpawner',
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain("Node 'root/EnemySpawner' removed successfully");
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Cannot remove the root node',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('remove_node')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot remove the root node'),
        expect.any(Array),
      );
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('remove_node')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/SomeNode',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe('attach_script', () => {
    it('registers the attach_script tool', () => {
      expect(handlers.has('attach_script')).toBe(true);
    });

    it('passes correct params to runOperation', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: true,
        data: { success: true, node: 'root/Player', script: 'scripts/player.gd' },
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('attach_script')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(runOperation).toHaveBeenCalledWith(
        ctx,
        '/my/project',
        'attach_script',
        expect.objectContaining({
          scenePath: 'scenes/main.tscn',
          nodePath: 'root/Player',
          scriptPath: 'scripts/player.gd',
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain(
        "Script 'scripts/player.gd' attached to node 'root/Player'",
      );
    });

    it('returns toolError when runOperation yields ok:false', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(runOperation).mockResolvedValue({
        ok: false,
        error: 'Failed to load script: res://scripts/player.gd',
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('attach_script')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load script: res://scripts/player.gd'),
        expect.any(Array),
      );
    });

    it('returns toolError for invalid paths containing ".."', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('attach_script')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/../../../etc/passwd',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for missing project.godot', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('attach_script')!;
      const result = await handler({
        project_path: '/not/a/project',
        scene_path: 'scenes/main.tscn',
        node_path: 'root/Player',
        script_path: 'scripts/player.gd',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });
  });

  // ── path hardening rollout (resolveWithinProject) ───────────────────

  describe('path hardening', () => {
    beforeEach(() => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
    });

    async function expectPathRejected(
      tool: string,
      params: Record<string, unknown>,
      paramName: string,
    ): Promise<void> {
      const handler = handlers.get(tool)!;
      const result = (await handler(params)) as {
        isError?: boolean;
        content?: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content?.[0].text).toContain(paramName);
    }

    it('create_scene rejects scene_path traversal outside the project', async () => {
      await expectPathRejected('create_scene', { project_path: '/proj', scene_path: '../../etc/evil.tscn' }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('create_scene rejects scene_path containing a null byte', async () => {
      await expectPathRejected('create_scene', { project_path: '/proj', scene_path: 'scenes/\0evil.tscn' }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('create_scene rejects an absolute scene_path outside the project', async () => {
      await expectPathRejected('create_scene', { project_path: '/proj', scene_path: '/etc/evil.tscn' }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('create_scene rejects a script path as root_node_type (arbitrary instantiation guard)', async () => {
      await expectPathRejected('create_scene', { project_path: '/proj', scene_path: 'scenes/main.tscn', root_node_type: 'res://evil.gd' }, 'root_node_type');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('create_scene rejects a non-identifier root_node_type', async () => {
      await expectPathRejected('create_scene', { project_path: '/proj', scene_path: 'scenes/main.tscn', root_node_type: 'Node2D; evil' }, 'root_node_type');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('add_node rejects scene_path traversal before touching the scene file', async () => {
      await expectPathRejected('add_node', { project_path: '/proj', scene_path: '../out.tscn', node_type: 'Node2D', node_name: 'N' }, 'scene_path');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('load_sprite rejects texture_path traversal', async () => {
      await expectPathRejected('load_sprite', { project_path: '/proj', scene_path: 'scenes/main.tscn', node_path: 'root/Sprite', texture_path: '../../secret.png' }, 'texture_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('export_mesh_library rejects output_path traversal', async () => {
      await expectPathRejected('export_mesh_library', { project_path: '/proj', scene_path: 'scenes/main.tscn', output_path: '../../out.res' }, 'output_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('save_scene rejects new_path traversal', async () => {
      await expectPathRejected('save_scene', { project_path: '/proj', scene_path: 'scenes/main.tscn', new_path: '../../variant.tscn' }, 'new_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('read_scene rejects scene_path traversal before reading the file', async () => {
      await expectPathRejected('read_scene', { project_path: '/proj', scene_path: '../../../etc/passwd' }, 'scene_path');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('modify_node_property rejects scene_path traversal', async () => {
      await expectPathRejected('modify_node_property', { project_path: '/proj', scene_path: '../x.tscn', node_path: 'root', property_name: 'visible', value: true }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('remove_node rejects scene_path traversal', async () => {
      await expectPathRejected('remove_node', { project_path: '/proj', scene_path: '../x.tscn', node_path: 'root/N' }, 'scene_path');
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('attach_script rejects script_path traversal', async () => {
      await expectPathRejected('attach_script', { project_path: '/proj', scene_path: 'scenes/main.tscn', node_path: 'root', script_path: '../../evil.gd' }, 'script_path');
      expect(runOperation).not.toHaveBeenCalled();
    });
  });
});
