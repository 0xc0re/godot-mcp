/**
 * Tests for MCP resource registration: godot-scene and godot-script resources.
 *
 * Uses vi.mock() to isolate resource logic from filesystem.
 * Spies on server.registerResource to capture registration calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/types.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    // Identity realpath so the real resolveWithinProject containment logic can
    // run against the fake /test/project tree without touching the real fs.
    realpathSync: vi.fn((p: unknown) => String(p)),
  };
});

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { registerGodotResources } from '../src/resources/godot-resources.js';

function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
  };
}

describe('MCP Resource Registration', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let registerResourceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {}, resources: {} } },
    );
    ctx = createTestContext();
    registerResourceSpy = vi.spyOn(server, 'registerResource');
  });

  it('registerGodotResources function exists and is callable', () => {
    expect(typeof registerGodotResources).toBe('function');
    // Should not throw when called
    expect(() => registerGodotResources(server, ctx)).not.toThrow();
  });

  it('registers a godot-scene resource with ResourceTemplate', () => {
    registerGodotResources(server, ctx);

    // Find scene registration call
    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    expect(sceneCall).toBeDefined();
    expect(sceneCall![1]).toBeInstanceOf(ResourceTemplate);
  });

  it('registers a godot-script resource with ResourceTemplate', () => {
    registerGodotResources(server, ctx);

    // Find script registration call
    const scriptCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-script',
    );
    expect(scriptCall).toBeDefined();
    expect(scriptCall![1]).toBeInstanceOf(ResourceTemplate);
  });

  it('scene resource list callback returns .tscn files from project directory', async () => {
    // Set up env variable for project path
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    // Mock project.godot existence check
    vi.mocked(existsSync).mockImplementation((p) => {
      const ps = String(p);
      if (ps.endsWith('project.godot')) return true;
      return false;
    });

    // Mock directory traversal: root has scenes/ and a file
    vi.mocked(readdirSync).mockImplementation((dir) => {
      const d = String(dir);
      if (d === '/test/project') {
        return [
          { name: 'main.tscn', isDirectory: () => false, isFile: () => true },
          { name: 'scenes', isDirectory: () => true, isFile: () => false },
          { name: '.godot', isDirectory: () => true, isFile: () => false },
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      if (d === '/test/project/scenes') {
        return [
          { name: 'level1.tscn', isDirectory: () => false, isFile: () => true },
          { name: 'player.gd', isDirectory: () => false, isFile: () => true },
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    registerGodotResources(server, ctx);

    // Extract the list callback from the ResourceTemplate
    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    const template = sceneCall![1] as ResourceTemplate;
    const listResult = await template.listCallback!({} as never);

    expect(listResult.resources).toHaveLength(2);
    expect(listResult.resources.map((r: { uri: string }) => r.uri)).toEqual(
      expect.arrayContaining([
        'godot://scene/main.tscn',
        'godot://scene/scenes/level1.tscn',
      ]),
    );

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('script resource list callback returns .gd files from project directory', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    vi.mocked(existsSync).mockImplementation((p) => {
      const ps = String(p);
      if (ps.endsWith('project.godot')) return true;
      return false;
    });

    vi.mocked(readdirSync).mockImplementation((dir) => {
      const d = String(dir);
      if (d === '/test/project') {
        return [
          { name: 'scripts', isDirectory: () => true, isFile: () => false },
          { name: '.git', isDirectory: () => true, isFile: () => false },
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      if (d === '/test/project/scripts') {
        return [
          { name: 'player.gd', isDirectory: () => false, isFile: () => true },
          { name: 'enemy.gd', isDirectory: () => false, isFile: () => true },
          { name: 'scene.tscn', isDirectory: () => false, isFile: () => true },
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    registerGodotResources(server, ctx);

    const scriptCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-script',
    );
    const template = scriptCall![1] as ResourceTemplate;
    const listResult = await template.listCallback!({} as never);

    expect(listResult.resources).toHaveLength(2);
    expect(listResult.resources.map((r: { uri: string }) => r.uri)).toEqual(
      expect.arrayContaining([
        'godot://script/scripts/player.gd',
        'godot://script/scripts/enemy.gd',
      ]),
    );

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('scene resource read callback returns file content as text', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('[gd_scene format=3]\n[node name="Main" type="Node2D"]');

    registerGodotResources(server, ctx);

    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    // The read callback is the 4th argument
    const readCallback = sceneCall![3] as (uri: URL, variables: Record<string, string>, extra: unknown) => Promise<{ contents: Array<{ uri: string; text: string }> }>;

    const result = await readCallback(
      new URL('godot://scene/main.tscn'),
      { path: 'main.tscn' },
      {} as never,
    );

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('godot://scene/main.tscn');
    expect(result.contents[0].text).toBe('[gd_scene format=3]\n[node name="Main" type="Node2D"]');

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('script resource read callback returns file content as text', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('extends Node2D\n\nfunc _ready():\n\tpass');

    registerGodotResources(server, ctx);

    const scriptCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-script',
    );
    const readCallback = scriptCall![3] as (uri: URL, variables: Record<string, string>, extra: unknown) => Promise<{ contents: Array<{ uri: string; text: string }> }>;

    const result = await readCallback(
      new URL('godot://script/scripts/player.gd'),
      { path: 'scripts/player.gd' },
      {} as never,
    );

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('godot://script/scripts/player.gd');
    expect(result.contents[0].text).toBe('extends Node2D\n\nfunc _ready():\n\tpass');

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('scene read callback denies ".." traversal outside the project', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('root:x:0:0');

    registerGodotResources(server, ctx);

    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    const readCallback = sceneCall![3] as (uri: URL, variables: Record<string, string>, extra: unknown) => Promise<unknown>;

    await expect(
      readCallback(
        new URL('godot://scene/../../../etc/passwd'),
        { path: '../../../etc/passwd' },
        {} as never,
      ),
    ).rejects.toThrow(/Access denied/);
    expect(readFileSync).not.toHaveBeenCalled();

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('script read callback denies absolute paths outside the project', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('secret');

    registerGodotResources(server, ctx);

    const scriptCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-script',
    );
    const readCallback = scriptCall![3] as (uri: URL, variables: Record<string, string>, extra: unknown) => Promise<unknown>;

    await expect(
      readCallback(
        new URL('godot://script/x.gd'),
        { path: '/etc/shadow.gd' },
        {} as never,
      ),
    ).rejects.toThrow(/Access denied/);
    expect(readFileSync).not.toHaveBeenCalled();

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('read callbacks deny when no project resolves (no arbitrary-read fallback)', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    delete process.env.GODOT_PROJECT_PATH;

    // No project.godot anywhere -> resolveProjectPath() returns null
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('root:x:0:0');

    registerGodotResources(server, ctx);

    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    const readCallback = sceneCall![3] as (uri: URL, variables: Record<string, string>, extra: unknown) => Promise<unknown>;

    await expect(
      readCallback(
        new URL('godot://scene/etc/passwd'),
        { path: '/etc/passwd' },
        {} as never,
      ),
    ).rejects.toThrow(/Access denied/);
    expect(readFileSync).not.toHaveBeenCalled();

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('scene read callback denies non-.tscn files (extension allowlist)', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    process.env.GODOT_PROJECT_PATH = '/test/project';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('data');

    registerGodotResources(server, ctx);

    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    const readCallback = sceneCall![3] as (uri: URL, variables: Record<string, string>, extra: unknown) => Promise<unknown>;

    await expect(
      readCallback(
        new URL('godot://scene/project.godot'),
        { path: 'project.godot' },
        {} as never,
      ),
    ).rejects.toThrow(/Access denied/);
    expect(readFileSync).not.toHaveBeenCalled();

    process.env.GODOT_PROJECT_PATH = origEnv;
  });

  it('handles missing GODOT_PROJECT_PATH gracefully (empty resource list)', async () => {
    const origEnv = process.env.GODOT_PROJECT_PATH;
    delete process.env.GODOT_PROJECT_PATH;

    // No project.godot in cwd either
    vi.mocked(existsSync).mockReturnValue(false);

    registerGodotResources(server, ctx);

    // Scene list should be empty
    const sceneCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-scene',
    );
    const sceneTemplate = sceneCall![1] as ResourceTemplate;
    const sceneList = await sceneTemplate.listCallback!({} as never);
    expect(sceneList.resources).toHaveLength(0);

    // Script list should be empty
    const scriptCall = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'godot-script',
    );
    const scriptTemplate = scriptCall![1] as ResourceTemplate;
    const scriptList = await scriptTemplate.listCallback!({} as never);
    expect(scriptList.resources).toHaveLength(0);

    process.env.GODOT_PROJECT_PATH = origEnv;
  });
});
