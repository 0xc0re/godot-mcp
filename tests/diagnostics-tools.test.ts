/**
 * Tests for get_diagnostics MCP tool.
 *
 * Uses vi.mock() to isolate tool logic from filesystem, LSP client, and Godot process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
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
  trackProcess: vi.fn((_ctx: unknown, proc: unknown) => proc),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock net module for port probing
vi.mock('net', () => {
  const { EventEmitter } = require('events');
  return {
    Socket: class MockSocket extends EventEmitter {
      connect = vi.fn();
      destroy = vi.fn();
      end = vi.fn();
    },
    createConnection: vi.fn(),
  };
});

// Mock LspClient
const mockGetDiagnostics = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockIsConnected = vi.fn().mockReturnValue(false);

vi.mock('../src/lsp/client.js', () => ({
  LspClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    getDiagnostics: mockGetDiagnostics,
    disconnect: mockDisconnect,
    get isConnected() {
      return mockIsConnected();
    },
  })),
}));

// Mock tscn-parser for validate_scene tests
vi.mock('../src/parsers/tscn-parser.js', () => ({
  parseScene: vi.fn(),
}));

// Mock project-parser for validate_scene autoload detection
vi.mock('../src/parsers/project-parser.js', () => ({
  parseProjectSettings: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { validatePath } from '../src/godot.js';
import { parseScene } from '../src/parsers/tscn-parser.js';
import { parseProjectSettings } from '../src/parsers/project-parser.js';
import { registerDiagnosticsTools } from '../src/tools/diagnostics.js';
import type { ParsedScene } from '../src/parsers/tscn-types.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(server: McpServer): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
    return originalRegisterTool(name, _config, handler);
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

describe('Diagnostics MCP Tools', () => {
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
    registerDiagnosticsTools(server, ctx);
  });

  describe('get_diagnostics', () => {
    it('registers the get_diagnostics tool', () => {
      expect(handlers.has('get_diagnostics')).toBe(true);
    });

    it('returns toolError for invalid file path', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/bad/../path/test.gd',
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for non-existent file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/nonexistent.gd',
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError for non-.gd file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/readme.txt',
        project_path: '/my/project',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns diagnostics array for a file with errors', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('var x = ;');

      // Simulate existing connected LSP client
      mockIsConnected.mockReturnValue(true);
      ctx.lspClient = {
        connect: mockConnect,
        getDiagnostics: mockGetDiagnostics,
        disconnect: mockDisconnect,
        get isConnected() { return mockIsConnected(); },
      } as unknown as import('../src/lsp/client.js').LspClient;

      mockGetDiagnostics.mockResolvedValue([
        {
          range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } },
          severity: 1,
          message: 'Expected expression',
          source: 'gdscript',
        },
      ]);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/test.gd',
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.diagnostics).toHaveLength(1);
      expect(parsed.diagnostics[0].message).toBe('Expected expression');
      expect(parsed.count).toBe(1);
      expect(parsed.file).toBe('/my/project/test.gd');
    });

    it('returns empty diagnostics array for a clean file', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('extends Node\n\nfunc _ready():\n\tpass\n');

      mockIsConnected.mockReturnValue(true);
      ctx.lspClient = {
        connect: mockConnect,
        getDiagnostics: mockGetDiagnostics,
        disconnect: mockDisconnect,
        get isConnected() { return mockIsConnected(); },
      } as unknown as import('../src/lsp/client.js').LspClient;

      mockGetDiagnostics.mockResolvedValue([]);

      const handler = handlers.get('get_diagnostics')!;
      const result = await handler({
        file_path: '/my/project/clean.gd',
        project_path: '/my/project',
      }) as { content: Array<{ type: string; text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.count).toBe(0);
    });
  });

  // ── validate_scene ──────────────────────────────────────────────────

  describe('validate_scene', () => {
    it('registers the validate_scene tool', () => {
      expect(handlers.has('validate_scene')).toBe(true);
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/bad/../path',
        scene_path: 'scenes/player.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('returns toolError when scene file does not exist', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((p) => {
        // project.godot exists, scene file does not
        if (String(p).endsWith('project.godot')) return true;
        return false;
      });

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/missing.tscn',
      }) as { isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('detects physics body without collision shape (error severity)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');

      const mockScene: ParsedScene = {
        format: 3,
        loadSteps: 1,
        extResources: [],
        subResources: [],
        nodes: [
          { name: 'Root', type: 'Node3D', properties: {} },
          { name: 'Player', type: 'CharacterBody3D', parent: '.', properties: {} },
          // No CollisionShape3D child -> should trigger error
        ],
        connections: [],
      };
      vi.mocked(parseScene).mockReturnValue(mockScene);

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const bodyIssue = parsed.issues.find(
        (i: { check: string }) => i.check === 'physics_body_without_collision_shape',
      );
      expect(bodyIssue).toBeDefined();
      expect(bodyIssue.severity).toBe('error');
      expect(bodyIssue.nodes).toContain('Root/Player');
      expect(parsed.summary.errors).toBeGreaterThanOrEqual(1);
    });

    it('detects Area3D without collision shape (warning severity)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');

      const mockScene: ParsedScene = {
        format: 3,
        loadSteps: 1,
        extResources: [],
        subResources: [],
        nodes: [
          { name: 'Root', type: 'Node3D', properties: {} },
          { name: 'HitBox', type: 'Area3D', parent: '.', properties: {} },
          // No CollisionShape3D child -> should trigger warning
        ],
        connections: [],
      };
      vi.mocked(parseScene).mockReturnValue(mockScene);

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/area.tscn',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const areaIssue = parsed.issues.find(
        (i: { check: string }) => i.check === 'area_without_collision_shape',
      );
      expect(areaIssue).toBeDefined();
      expect(areaIssue.severity).toBe('warning');
      expect(areaIssue.nodes).toContain('Root/HitBox');
      expect(parsed.summary.warnings).toBeGreaterThanOrEqual(1);
    });

    it('detects duplicate sibling names (warning severity)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');

      const mockScene: ParsedScene = {
        format: 3,
        loadSteps: 1,
        extResources: [],
        subResources: [],
        nodes: [
          { name: 'Root', type: 'Node3D', properties: {} },
          { name: 'Enemy', type: 'Node3D', parent: '.', properties: {} },
          { name: 'Enemy', type: 'Node3D', parent: '.', properties: {} },
        ],
        connections: [],
      };
      vi.mocked(parseScene).mockReturnValue(mockScene);

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/level.tscn',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const dupIssue = parsed.issues.find(
        (i: { check: string }) => i.check === 'duplicate_sibling_names',
      );
      expect(dupIssue).toBeDefined();
      expect(dupIssue.severity).toBe('warning');
      expect(dupIssue.nodes).toEqual(
        expect.arrayContaining([expect.stringContaining('Enemy')]),
      );
      expect(parsed.summary.warnings).toBeGreaterThanOrEqual(1);
    });

    it('returns empty issues for a clean scene', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');

      const mockScene: ParsedScene = {
        format: 3,
        loadSteps: 1,
        extResources: [],
        subResources: [],
        nodes: [
          { name: 'Root', type: 'Node3D', properties: {} },
          { name: 'Player', type: 'CharacterBody3D', parent: '.', properties: {} },
          { name: 'CollisionShape3D', type: 'CollisionShape3D', parent: 'Player', properties: {} },
          { name: 'MeshInstance3D', type: 'MeshInstance3D', parent: 'Player', properties: {} },
        ],
        connections: [],
      };
      vi.mocked(parseScene).mockReturnValue(mockScene);

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/clean.tscn',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.issues).toEqual([]);
      expect(parsed.summary.errors).toBe(0);
      expect(parsed.summary.warnings).toBe(0);
      expect(parsed.summary.info).toBe(0);
    });

    it('detects root script referencing autoloads (warning severity)', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      // readFileSync is called multiple times:
      // 1. Scene file content (for parseScene — we mock parseScene so this doesn't matter)
      // 2. The GDScript file content (the root node's script)
      // 3. project.godot content (for autoload detection)
      vi.mocked(readFileSync).mockImplementation((filePath) => {
        const p = String(filePath);
        if (p.endsWith('player.gd')) {
          return 'extends CharacterBody3D\n\nfunc _ready():\n\tGameManager.start()\n\tAudioManager.play("sfx")\n';
        }
        if (p.endsWith('project.godot')) {
          return '[autoload]\nGameManager="*res://autoloads/game_manager.gd"\nAudioManager="*res://autoloads/audio_manager.gd"\n';
        }
        // Scene file content — parseScene is mocked so this value is not used
        return '';
      });

      const mockScene: ParsedScene = {
        format: 3,
        loadSteps: 2,
        extResources: [
          { type: 'Script', path: 'res://scripts/player.gd', id: '1_abc' },
        ],
        subResources: [],
        nodes: [
          {
            name: 'Player',
            type: 'CharacterBody3D',
            properties: { script: 'ExtResource("1_abc")' },
          },
          { name: 'CollisionShape3D', type: 'CollisionShape3D', parent: '.', properties: {} },
        ],
        connections: [],
      };
      vi.mocked(parseScene).mockReturnValue(mockScene);

      // parseProjectSettings is called with the project.godot content
      vi.mocked(parseProjectSettings).mockReturnValue({
        sections: {
          autoload: {
            GameManager: '"*res://autoloads/game_manager.gd"',
            AudioManager: '"*res://autoloads/audio_manager.gd"',
          },
        },
        configVersion: 0,
      });

      const handler = handlers.get('validate_scene')!;
      const result = await handler({
        project_path: '/my/project',
        scene_path: 'scenes/player.tscn',
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      const autoloadIssue = parsed.issues.find(
        (i: { check: string }) => i.check === 'root_script_references_autoloads',
      );
      expect(autoloadIssue).toBeDefined();
      expect(autoloadIssue.severity).toBe('warning');
      expect(autoloadIssue.nodes).toContain('Player');
      expect(autoloadIssue.detail).toContain('GameManager');
      expect(autoloadIssue.detail).toContain('AudioManager');
      expect(autoloadIssue.detail).toContain('MCP add_node/modify_node may corrupt');
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

    it('validate_scene rejects scene_path traversal before reading the file', async () => {
      await expectPathRejected('validate_scene', { project_path: '/proj', scene_path: '../../../etc/passwd' }, 'scene_path');
      expect(readFileSync).not.toHaveBeenCalled();
    });
  });
});
