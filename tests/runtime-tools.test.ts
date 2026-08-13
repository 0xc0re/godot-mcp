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

// Mock helper-autoloads module (restart_project temporarily re-injects the
// RuntimeHelper autoload; the real implementation would spawn Godot).
vi.mock('../src/helper-autoloads.js', () => ({
  injectRuntimeHelper: vi.fn(async () => ({
    injected: true,
    selfHealed: false,
    failed: null,
    injection: { projectPath: '/my/project', previousValue: null },
  })),
  restoreHelperInjection: vi.fn(async () => true),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { validatePath, trackProcess } from '../src/godot.js';
import { toolError } from '../src/errors.js';
import { injectRuntimeHelper, restoreHelperInjection } from '../src/helper-autoloads.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(
  server: McpServer,
): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
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

  it('deletes stale output before writing the trigger so old results are never read', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    // Record the interleaving of fs calls to verify ordering
    const events: string[] = [];
    // A stale result file from a previous command is already on disk
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      return String(path).endsWith('runtime_result.json');
    });
    vi.mocked(unlinkSync).mockImplementation((path) => {
      events.push(`unlink:${String(path)}`);
    });
    vi.mocked(writeFileSync).mockImplementation((path) => {
      events.push(`write:${String(path)}`);
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'fresh' }));

    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('inspect_scene_tree')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const staleDelete = events.findIndex(
      (e) => e.startsWith('unlink:') && e.includes('runtime_result.json'),
    );
    const triggerWrite = events.findIndex(
      (e) => e.startsWith('write:') && e.includes('runtime_trigger'),
    );
    expect(staleDelete).toBeGreaterThanOrEqual(0);
    expect(triggerWrite).toBeGreaterThanOrEqual(0);
    // The stale output must be deleted BEFORE the trigger is written —
    // deleting after the trigger races the helper's fresh response.
    expect(staleDelete).toBeLessThan(triggerWrite);

    // And the fresh (post-trigger) result is what gets returned
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.name).toBe('fresh');
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

describe('restart_project', () => {
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

  it('registers the restart_project tool', () => {
    expect(handlers.has('restart_project')).toBe(true);
  });

  it('returns error when no active process', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);
    ctx.activeProcess = null;

    const handler = handlers.get('restart_project')!;
    const result = (await handler({ project_path: '/my/project' })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process to restart'),
      expect.any(Array),
    );
  });

  it('returns error for invalid project path', async () => {
    vi.mocked(validatePath).mockReturnValue(false);

    const handler = handlers.get('restart_project')!;
    const result = (await handler({ project_path: '/bad/../path' })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('returns error when project.godot is missing', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(false);
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('restart_project')!;
    const result = (await handler({ project_path: '/not/a/project' })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('Not a valid Godot project'),
      expect.any(Array),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns toolError when spawn throws instead of leaking the exception', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: [], errors: [] };

    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawn ENOENT');
    });

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(100);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to restart Godot project'),
      expect.any(Array),
    );
  });

  it('kills existing process and spawns new one', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    // Set up old mock process that exits immediately when killed
    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        // Fire exit callback immediately
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: ['old output'], errors: [] };

    // Set up new mock process returned by spawn
    const newProcess = {
      pid: 5678,
      killed: false,
      stdout: {
        on: vi.fn(),
        once: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            // Fire data callback immediately to confirm running
            setTimeout(() => cb(Buffer.from('Godot Engine v4.3')), 0);
          }
          return newProcess.stdout;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((_event: string, _cb: () => void) => newProcess),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(newProcess);

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({ project_path: '/my/project' });

    // Advance timers to allow exit callback and stdout data to fire
    await vi.advanceTimersByTimeAsync(100);

    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    // Verify old process was killed
    expect(oldProcess.kill).toHaveBeenCalled();

    // Verify spawn was called with correct args
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/godot',
      ['-d', '--path', '/my/project'],
      { stdio: 'pipe' },
    );

    // Verify ctx.activeProcess was updated to new process
    expect(ctx.activeProcess).not.toBeNull();
    expect(ctx.activeProcess!.process).toBe(newProcess);

    // Verify result contains PID and running status
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.pid).toBe(5678);
    expect(parsed.running).toBe(true);
  });

  it('restores the previous injection, then re-injects the RuntimeHelper before relaunching', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: [], errors: [] };
    const oldInjection = { projectPath: '/my/project', previousValue: null };
    ctx.helperInjection = oldInjection;

    const newProcess = {
      pid: 5678,
      killed: false,
      stdout: {
        on: vi.fn(),
        once: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(Buffer.from('Godot Engine v4.3')), 0);
          }
          return newProcess.stdout;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((_event: string, _cb: () => void) => newProcess),
    } as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(newProcess);

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    // Outgoing run's injection restored, then a fresh injection performed
    expect(restoreHelperInjection).toHaveBeenCalledWith(ctx, oldInjection);
    expect(injectRuntimeHelper).toHaveBeenCalledWith(ctx, '/my/project');
  });

  it('skips re-injection when inject_helpers is false', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: [], errors: [] };

    const newProcess = {
      pid: 5678,
      killed: false,
      stdout: {
        on: vi.fn(),
        once: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(Buffer.from('Godot Engine v4.3')), 0);
          }
          return newProcess.stdout;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((_event: string, _cb: () => void) => newProcess),
    } as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(newProcess);

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({ project_path: '/my/project', inject_helpers: false });
    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    expect(injectRuntimeHelper).not.toHaveBeenCalled();
  });

  it('registers exit/error handlers that clear ctx.activeProcess for the new process', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: [], errors: [] };

    const newProcess = {
      pid: 4321,
      killed: false,
      stdout: {
        on: vi.fn(),
        once: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(Buffer.from('Godot Engine v4.3')), 0);
          }
          return newProcess.stdout;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((_event: string, _cb: () => void) => newProcess),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(newProcess);

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    expect(ctx.activeProcess).not.toBeNull();

    // Find the registered exit handler and fire it — activeProcess must clear
    // (cast: ChildProcess.on's overloads collapse the tuple type to one event)
    const onCalls = vi.mocked(newProcess.on).mock.calls as unknown as Array<
      [string, (...args: unknown[]) => void]
    >;
    const exitHandler = onCalls.find(([event]) => event === 'exit')?.[1] as
      | ((code: number | null) => void)
      | undefined;
    expect(exitHandler).toBeDefined();
    exitHandler!(0);
    expect(ctx.activeProcess).toBeNull();

    // Restore state and fire the error handler — same clearing behavior
    ctx.activeProcess = { process: newProcess, output: [], errors: [] };
    const errorHandler = onCalls.find(([event]) => event === 'error')?.[1] as
      | ((err: Error) => void)
      | undefined;
    expect(errorHandler).toBeDefined();
    errorHandler!(new Error('crashed'));
    expect(ctx.activeProcess).toBeNull();
  });

  it('includes scene parameter when provided', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    // Old process
    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: [], errors: [] };

    // New process
    const newProcess = {
      pid: 9999,
      killed: false,
      stdout: {
        on: vi.fn(),
        once: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(Buffer.from('Godot Engine v4.3')), 0);
          }
          return newProcess.stdout;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((_event: string, _cb: () => void) => newProcess),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(newProcess);

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({
      project_path: '/my/project',
      scene: '/path/to/scene.tscn',
    });

    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    // Verify spawn args include scene
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/godot',
      ['-d', '--path', '/my/project', '/path/to/scene.tscn'],
      { stdio: 'pipe' },
    );
  });

  it('confirms running by waiting for stdout output', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    // Old process
    const oldProcess = createMockProcess();
    vi.mocked(oldProcess.once).mockImplementation(((event: string, cb: () => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(), 0);
      }
      return oldProcess;
    }) as typeof oldProcess.once);
    ctx.activeProcess = { process: oldProcess, output: [], errors: [] };

    // New process - stdout fires data event, confirming it's running
    const newProcess = {
      pid: 7777,
      killed: false,
      stdout: {
        on: vi.fn(),
        once: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(Buffer.from('Engine initialized')), 10);
          }
          return newProcess.stdout;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((_event: string, _cb: () => void) => newProcess),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(newProcess);

    const handler = handlers.get('restart_project')!;
    const resultPromise = handler({ project_path: '/my/project' });

    await vi.advanceTimersByTimeAsync(100);

    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.running).toBe(true);
    expect(parsed.message).toContain('restarted');
  });
});

/**
 * Shared existsSync behavior for the interaction tools (send_input,
 * invoke_runtime, wait_for): the withProject preamble needs project.godot to
 * exist, and triggerAndPoll polls for runtime_result.json.
 */
function mockFsForIpc(resultFileExists = true): void {
  vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
    const p = String(path);
    if (p.endsWith('project.godot')) return true;
    if (p.endsWith('runtime_result.json')) return resultFileExists;
    return false;
  });
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  vi.mocked(unlinkSync).mockReturnValue(undefined);
}

/** Extract the parsed JSON bodies of all runtime_trigger writes. */
function triggerWrites(): Array<{ command: string; params: Record<string, unknown> }> {
  return vi
    .mocked(writeFileSync)
    .mock.calls.filter(([path]) => String(path).includes('runtime_trigger'))
    .map(([, body]) => JSON.parse(String(body)) as { command: string; params: Record<string, unknown> });
}

describe('send_input', () => {
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

  it('registers the send_input tool', () => {
    expect(handlers.has('send_input')).toBe(true);
  });

  it('returns error for invalid project path', async () => {
    vi.mocked(validatePath).mockReturnValue(false);

    const handler = handlers.get('send_input')!;
    const result = (await handler({
      project_path: '/bad/../path',
      input: { event_type: 'action', action: 'jump' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = null;

    const handler = handlers.get('send_input')!;
    const result = (await handler({
      project_path: '/my/project',
      input: { event_type: 'action', action: 'jump' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('rejects event_type "action" without an action name before any IPC', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('send_input')!;
    const result = (await handler({
      project_path: '/my/project',
      input: { event_type: 'action' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining("'action' is required"),
      expect.any(Array),
    );
    expect(triggerWrites()).toHaveLength(0);
  });

  it('rejects event_type "key" without a keycode before any IPC', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('send_input')!;
    const result = (await handler({
      project_path: '/my/project',
      input: { event_type: 'key' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(triggerWrites()).toHaveLength(0);
  });

  it('writes a send_input trigger and returns the helper result', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ success: true, event_type: 'action', action: 'jump', pressed: true }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('send_input')!;
    const resultPromise = handler({
      project_path: '/my/project',
      input: { event_type: 'action', action: 'jump', pressed: true },
    });
    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const writes = triggerWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].command).toBe('send_input');
    expect(writes[0].params).toEqual({ event_type: 'action', action: 'jump', pressed: true });

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('jump');
  });

  it('converts a structured helper error into a tool error', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ error: 'send_input: unknown input action: warp' }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('send_input')!;
    const resultPromise = handler({
      project_path: '/my/project',
      input: { event_type: 'action', action: 'warp' },
    });
    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('unknown input action'),
      expect.any(Array),
    );
  });

  it('returns a timeout error when the helper never responds', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc(false);
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('send_input')!;
    const resultPromise = handler({
      project_path: '/my/project',
      input: { event_type: 'action', action: 'jump' },
    });
    await vi.advanceTimersByTimeAsync(6000);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.arrayContaining([expect.stringContaining('RuntimeHelper')]),
    );
  });
});

describe('invoke_runtime', () => {
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

  it('registers the invoke_runtime tool', () => {
    expect(handlers.has('invoke_runtime')).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = null;

    const handler = handlers.get('invoke_runtime')!;
    const result = (await handler({
      project_path: '/my/project',
      node_path: '/root/Main',
      operation: 'call_method',
      method: 'reset',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('rejects an expression-like method string before any IPC (no eval surface)', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const result = (await handler({
      project_path: '/my/project',
      node_path: '/root/Main',
      operation: 'call_method',
      method: 'get_node("/root").free()',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('plain identifier'),
      expect.any(Array),
    );
    expect(triggerWrites()).toHaveLength(0);
  });

  it('rejects an expression-like property path before any IPC (no eval surface)', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const result = (await handler({
      project_path: '/my/project',
      node_path: '/root/Main',
      operation: 'set_property',
      property: 'position.x + 100',
      value: 1,
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(triggerWrites()).toHaveLength(0);
  });

  it('rejects set_property without a value', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const result = (await handler({
      project_path: '/my/project',
      node_path: '/root/Main',
      operation: 'set_property',
      property: 'health',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining("'value' is required"),
      expect.any(Array),
    );
    expect(triggerWrites()).toHaveLength(0);
  });

  it('writes a call_method trigger with typed args and returns the result', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        success: true,
        node_path: '/root/Main/Player',
        method: 'bump',
        result: 3,
      }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const resultPromise = handler({
      project_path: '/my/project',
      node_path: '/root/Main/Player',
      operation: 'call_method',
      method: 'bump',
      args: [3],
    });
    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const writes = triggerWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].command).toBe('call_method');
    expect(writes[0].params).toEqual({
      node_path: '/root/Main/Player',
      method: 'bump',
      args: [3],
    });

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.success).toBe(true);
    expect(parsed.result).toBe(3);
  });

  it('writes a set_property trigger and returns the read-back value', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        success: true,
        node_path: '/root/Main/Player',
        property: 'position:x',
        value: 42,
      }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const resultPromise = handler({
      project_path: '/my/project',
      node_path: '/root/Main/Player',
      operation: 'set_property',
      property: 'position:x',
      value: 42,
    });
    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const writes = triggerWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].command).toBe('set_property');
    expect(writes[0].params).toEqual({
      node_path: '/root/Main/Player',
      property: 'position:x',
      value: 42,
    });

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.value).toBe(42);
  });

  it('converts a node-not-found helper error into a tool error', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ error: 'Node not found: /root/Missing' }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const resultPromise = handler({
      project_path: '/my/project',
      node_path: '/root/Missing',
      operation: 'call_method',
      method: 'reset',
    });
    await vi.advanceTimersByTimeAsync(200);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('Node not found'),
      expect.any(Array),
    );
  });

  it('returns a timeout error when the helper never responds', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc(false);
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('invoke_runtime')!;
    const resultPromise = handler({
      project_path: '/my/project',
      node_path: '/root/Main',
      operation: 'call_method',
      method: 'reset',
    });
    await vi.advanceTimersByTimeAsync(6000);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.arrayContaining([expect.stringContaining('RuntimeHelper')]),
    );
  });
});

describe('wait_for', () => {
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

  it('registers the wait_for tool', () => {
    expect(handlers.has('wait_for')).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = null;

    const handler = handlers.get('wait_for')!;
    const result = (await handler({
      project_path: '/my/project',
      condition: { type: 'node_exists', node_path: '/root/Main' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('rejects a property condition without a value before any IPC', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('wait_for')!;
    const result = (await handler({
      project_path: '/my/project',
      condition: { type: 'property', node_path: '/root/Main', property: 'health' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining("'value' is required"),
      expect.any(Array),
    );
    expect(triggerWrites()).toHaveLength(0);
  });

  it('rejects an expression-like property path before any IPC (no eval surface)', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('wait_for')!;
    const result = (await handler({
      project_path: '/my/project',
      condition: {
        type: 'property',
        node_path: '/root/Main',
        property: 'position.x > 100',
        value: true,
      },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(triggerWrites()).toHaveLength(0);
  });

  it('resolves when the condition becomes true on the Nth poll', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    let reads = 0;
    vi.mocked(readFileSync).mockImplementation(() => {
      reads += 1;
      return JSON.stringify(
        reads >= 3 ? { passed: true, observed: 42 } : { passed: false, observed: 0 },
      );
    });

    const handler = handlers.get('wait_for')!;
    const resultPromise = handler({
      project_path: '/my/project',
      condition: {
        type: 'property',
        node_path: '/root/Main/Player',
        property: 'health',
        op: 'eq',
        value: 42,
      },
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.passed).toBe(true);
    expect(parsed.observed).toBe(42);
    expect(parsed.polls).toBe(3);

    // Every poll sent a check_condition command with the structured spec
    const writes = triggerWrites();
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      expect(write.command).toBe('check_condition');
      expect(write.params.condition).toMatchObject({ type: 'property', op: 'eq', value: 42 });
    }
  });

  it('returns a timeout error with the last observed value when the condition never passes', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ passed: false, observed: 7 }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('wait_for')!;
    const resultPromise = handler({
      project_path: '/my/project',
      condition: {
        type: 'property',
        node_path: '/root/Main/Player',
        property: 'health',
        op: 'eq',
        value: 42,
      },
      timeout_ms: 500,
      poll_interval_ms: 100,
    });
    await vi.advanceTimersByTimeAsync(3000);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('timed out after 500ms'),
      expect.any(Array),
    );
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('Last observed value: 7'),
      expect.any(Array),
    );
  });

  it('anchors elapsed_frames on the first poll, then passes since_frame', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    let reads = 0;
    vi.mocked(readFileSync).mockImplementation(() => {
      reads += 1;
      return JSON.stringify(
        reads >= 2 ? { passed: true, observed: 110 } : { passed: false, observed: 100 },
      );
    });

    const handler = handlers.get('wait_for')!;
    const resultPromise = handler({
      project_path: '/my/project',
      condition: { type: 'elapsed_frames', frames: 10 },
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = (await resultPromise) as {
      content: Array<{ type: string; text?: string }>;
    };

    const writes = triggerWrites();
    expect(writes.length).toBeGreaterThanOrEqual(2);
    // Baseline poll carries no anchor; subsequent polls carry since_frame
    expect(writes[0].params.condition).not.toHaveProperty('since_frame');
    expect(writes[1].params.condition).toMatchObject({ since_frame: 100, frames: 10 });

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.passed).toBe(true);
    expect(parsed.observed).toBe(110);
  });

  it('surfaces a structured helper error instead of polling forever', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ error: "check_condition: unknown op: 'between'" }),
    );
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('wait_for')!;
    const resultPromise = handler({
      project_path: '/my/project',
      condition: { type: 'group_count', group: 'enemies', op: 'eq', value: 0 },
    });
    await vi.advanceTimersByTimeAsync(500);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('wait_for condition error'),
      expect.any(Array),
    );
    expect(triggerWrites()).toHaveLength(1);
  });

  it('returns a helper-unresponsive error when the IPC channel times out', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    mockFsForIpc(false);
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };

    const handler = handlers.get('wait_for')!;
    const resultPromise = handler({
      project_path: '/my/project',
      condition: { type: 'node_exists', node_path: '/root/Main' },
    });
    await vi.advanceTimersByTimeAsync(6000);
    const result = (await resultPromise) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('RuntimeHelper did not respond'),
      HELPER_TIMEOUT_SUGGESTIONS_MATCHER,
    );
  });
});

/** Matcher for the shared helper-timeout suggestion list. */
const HELPER_TIMEOUT_SUGGESTIONS_MATCHER = expect.arrayContaining([
  expect.stringContaining('RuntimeHelper'),
]);

describe('triggerAndPoll serialization (shared IPC channel)', () => {
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
    ctx.activeProcess = { process: createMockProcess(), output: [], errors: [] };
    vi.mocked(validatePath).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Simulate the REAL single-slot IPC disk: ONE trigger file and ONE result
   * file shared by every command. A simulated helper picks up the trigger
   * ~150ms after it is written and responds to whatever command is on the
   * file at that moment — exactly like runtime_helper.gd's 0.5s poll. A
   * second trigger written while one is pending overwrites it (counted in
   * `overwrites`), which is the destructive interleaving the serialization
   * exists to prevent.
   */
  function installIpcDiskSim(
    respond: (command: string) => Record<string, unknown> | null,
  ): { responded: string[]; overwrites: number } {
    const state = {
      trigger: null as string | null,
      result: null as string | null,
      responded: [] as string[],
      overwrites: 0,
    };
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('runtime_result.json')) return state.result !== null;
      if (p.endsWith('runtime_trigger')) return state.trigger !== null;
      return false;
    });
    vi.mocked(writeFileSync).mockImplementation((path, body) => {
      if (!String(path).includes('runtime_trigger')) return;
      if (state.trigger !== null) state.overwrites += 1;
      state.trigger = String(body);
      setTimeout(() => {
        if (state.trigger === null) return;
        const { command } = JSON.parse(state.trigger) as { command: string };
        const response = respond(command);
        if (response === null) return; // helper never answers this command
        state.trigger = null;
        state.result = JSON.stringify(response);
        state.responded.push(command);
      }, 150);
    });
    vi.mocked(unlinkSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith('runtime_trigger')) state.trigger = null;
      if (p.endsWith('runtime_result.json')) state.result = null;
    });
    vi.mocked(readFileSync).mockImplementation(() => state.result ?? '');
    return state;
  }

  it('send_input during a wait_for loop never cross-reads the other command result', async () => {
    const state = installIpcDiskSim((command) => {
      if (command === 'check_condition') return { passed: false, observed: 1 };
      if (command === 'send_input') {
        return { success: true, event_type: 'action', action: 'jump', pressed: true };
      }
      return { error: `unexpected command: ${command}` };
    });

    // wait_for loops on the channel while send_input arrives concurrently —
    // the reviewer's failure scenario: without serialization, send_input can
    // read a check_condition body ({passed, observed} has no "error" key) as
    // its own SUCCESS.
    const waitPromise = handlers.get('wait_for')!({
      project_path: '/my/project',
      condition: {
        type: 'property',
        node_path: '/root/Main',
        property: 'health',
        op: 'eq',
        value: 42,
      },
      timeout_ms: 1200,
      poll_interval_ms: 100,
    });
    const sendPromise = handlers.get('send_input')!({
      project_path: '/my/project',
      input: { event_type: 'action', action: 'jump' },
    });

    await vi.advanceTimersByTimeAsync(10000);
    const sendResult = (await sendPromise) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    const waitResult = (await waitPromise) as { isError?: boolean };

    // send_input got ITS OWN body — never the check_condition shape
    expect(sendResult.isError).not.toBe(true);
    const sendParsed = JSON.parse(sendResult.content[0].text!);
    expect(sendParsed).toMatchObject({ success: true, event_type: 'action', action: 'jump' });
    expect(sendParsed).not.toHaveProperty('passed');
    expect(sendParsed).not.toHaveProperty('observed');

    // wait_for timed out on its OWN condition, reporting its own observed
    // value — not the send_input body
    expect(waitResult.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('Last observed value: 1'),
      expect.any(Array),
    );

    // Serialization proof: no trigger was ever overwritten while pending,
    // and the helper answered every command that was sent
    expect(state.overwrites).toBe(0);
    expect(state.responded).toContain('send_input');
    expect(state.responded.filter((c) => c === 'check_condition').length).toBeGreaterThanOrEqual(2);
  });

  it('a timed-out request surfaces as a timeout error and does not wedge the channel', async () => {
    installIpcDiskSim((command) => {
      if (command === 'send_input') {
        return { success: true, event_type: 'action', action: 'jump', pressed: true };
      }
      return null; // helper never answers check_condition — lost/ignored trigger
    });

    const waitPromise = handlers.get('wait_for')!({
      project_path: '/my/project',
      condition: { type: 'node_exists', node_path: '/root/Main' },
    });
    const sendPromise = handlers.get('send_input')!({
      project_path: '/my/project',
      input: { event_type: 'action', action: 'jump' },
    });

    await vi.advanceTimersByTimeAsync(15000);
    const waitResult = (await waitPromise) as { isError?: boolean };
    const sendResult = (await sendPromise) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };

    // The unanswered command surfaced as a timeout error (not a hang, not a
    // cross-read of the queued command's result)
    expect(waitResult.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('RuntimeHelper did not respond'),
      expect.any(Array),
    );

    // The queued command still ran to completion after the failure
    expect(sendResult.isError).not.toBe(true);
    const sendParsed = JSON.parse(sendResult.content[0].text!);
    expect(sendParsed).toMatchObject({ success: true, action: 'jump' });
  });
});
