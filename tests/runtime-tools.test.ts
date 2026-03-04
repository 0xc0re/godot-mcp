/**
 * Tests for runtime inspection MCP tools: inspect_scene_tree, inspect_node, inspect_group.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChildProcess } from 'child_process';
import type { ServerContext } from '../src/types.js';
import { registerRuntimeTools } from '../src/tools/runtime.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock child_process module
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// Mock godot module
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  trackProcess: vi.fn((_ctx: unknown, proc: unknown) => proc),
}));

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { validatePath } from '../src/godot.js';
import { toolError } from '../src/errors.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(
  server: McpServer,
): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
    return originalRegisterTool(name, _config, handler);
  } as typeof server.registerTool;

  return handlers;
}

function createTestContext(overrides?: Partial<ServerContext>): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
    ...overrides,
  };
}

function createMockProcess(): ChildProcess {
  return {
    pid: 1234,
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    once: vi.fn(),
  } as unknown as ChildProcess;
}

describe('inspect_scene_tree', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    ctx = createTestContext();
    handlers = getToolHandlers(server);
    registerRuntimeTools(server, ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the inspect_scene_tree tool', () => {
    expect(handlers.has('inspect_scene_tree')).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    ctx.activeProcess = null;

    const handler = handlers.get('inspect_scene_tree')!;
    const result = (await handler({ project_path: '/my/project' })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('returns error for invalid project path', async () => {
    vi.mocked(validatePath).mockReturnValue(false);

    const handler = handlers.get('inspect_scene_tree')!;
    const result = (await handler({ project_path: '/bad/../path' })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('returns timeout error with helpful message when runtime_helper.gd is not installed', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('inspect_scene_tree')!;
    const resultPromise = handler({ project_path: '/my/project' });

    // Advance past the 5-second timeout
    await vi.advanceTimersByTimeAsync(6000);

    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.arrayContaining([expect.stringContaining('RuntimeHelper')]),
    );
  });

  it('writes trigger file and returns parsed JSON result on success', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const treeData = {
      name: 'root',
      type: 'Node3D',
      path: '/root',
      children: [],
    };

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('runtime_result.json')) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(treeData));

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('inspect_scene_tree')!;
    const resultPromise = handler({ project_path: '/my/project' });

    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    // Verify trigger was written with correct command
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('runtime_trigger'),
      JSON.stringify({ command: 'scene_tree', params: {} }),
    );

    // Verify result is returned as JSON text
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.name).toBe('root');
    expect(parsed.type).toBe('Node3D');
  });

  it('cleans up trigger and output files after success', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('runtime_result.json')) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'root' }));

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('inspect_scene_tree')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // Verify both files are cleaned up
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('runtime_result.json'));
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('runtime_trigger'));
  });
});

describe('inspect_node', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    ctx = createTestContext();
    handlers = getToolHandlers(server);
    registerRuntimeTools(server, ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the inspect_node tool', () => {
    expect(handlers.has('inspect_node')).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    ctx.activeProcess = null;

    const handler = handlers.get('inspect_node')!;
    const result = (await handler({
      project_path: '/my/project',
      node_path: '/root/Main/Player',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('writes trigger with node_path param and returns parsed result', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const nodeData = {
      name: 'Player',
      type: 'CharacterBody3D',
      path: '/root/Main/Player',
      properties: { speed: 200, health: 100 },
    };

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('runtime_result.json')) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(nodeData));

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('inspect_node')!;
    const resultPromise = handler({
      project_path: '/my/project',
      node_path: '/root/Main/Player',
    });

    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    // Verify trigger was written with correct command and params
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('runtime_trigger'),
      JSON.stringify({
        command: 'inspect_node',
        params: { node_path: '/root/Main/Player' },
      }),
    );

    // Verify result is returned
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.name).toBe('Player');
    expect(parsed.properties.speed).toBe(200);
  });

  it('returns error for invalid project path', async () => {
    vi.mocked(validatePath).mockReturnValue(false);

    const handler = handlers.get('inspect_node')!;
    const result = (await handler({
      project_path: '/bad/../path',
      node_path: '/root/Main',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });
});

describe('inspect_group', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    ctx = createTestContext();
    handlers = getToolHandlers(server);
    registerRuntimeTools(server, ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the inspect_group tool', () => {
    expect(handlers.has('inspect_group')).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    ctx.activeProcess = null;

    const handler = handlers.get('inspect_group')!;
    const result = (await handler({
      project_path: '/my/project',
      group: 'enemies',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('writes trigger with group param and returns parsed result', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const groupData = {
      group: 'enemies',
      count: 2,
      nodes: [
        { name: 'Zombie1', type: 'CharacterBody3D', path: '/root/Main/Zombie1' },
        { name: 'Zombie2', type: 'CharacterBody3D', path: '/root/Main/Zombie2' },
      ],
    };

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('runtime_result.json')) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(groupData));

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('inspect_group')!;
    const resultPromise = handler({
      project_path: '/my/project',
      group: 'enemies',
    });

    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    // Verify trigger was written with correct command and params
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('runtime_trigger'),
      JSON.stringify({
        command: 'get_group',
        params: { group: 'enemies' },
      }),
    );

    // Verify result is returned with correct structure
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.group).toBe('enemies');
    expect(parsed.count).toBe(2);
    expect(parsed.nodes).toHaveLength(2);
  });

  it('returns error for invalid project path', async () => {
    vi.mocked(validatePath).mockReturnValue(false);

    const handler = handlers.get('inspect_group')!;
    const result = (await handler({
      project_path: '/bad/../path',
      group: 'enemies',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });
});
