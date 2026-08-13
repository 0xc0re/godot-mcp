/**
 * Tests for editor MCP tools: launch_editor, run_project, get_debug_output,
 * stop_project. (capture_screenshot is covered by screenshot-tools.test.ts.)
 *
 * These tools drive Godot through spawn() rather than runOperation, so the
 * mocks sit at the child_process and godot.js module boundaries — same
 * approach as screenshot-tools.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChildProcess } from 'child_process';
import type { ServerContext } from '../src/types.js';
import { registerEditorTools } from '../src/tools/editor.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(),
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

// Mock godot module (validatePath + trackProcess are all these tools use)
vi.mock('../src/godot.js', async () => {
  const actual = await vi.importActual<typeof import('../src/godot.js')>('../src/godot.js');
  return {
    ...actual,
    validatePath: vi.fn(),
    trackProcess: vi.fn((_ctx: unknown, proc: unknown) => proc),
  };
});

// Mock errors module
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));

import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { validatePath } from '../src/godot.js';
import { toolError } from '../src/errors.js';

// Helper to extract registered tool handlers from McpServer
function getToolHandlers(server: McpServer): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
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

type Listener = (...args: unknown[]) => void;

/**
 * Mock spawned Godot process that records listeners so tests can fire
 * stdout/stderr data, exit, and error events on demand.
 */
function createMockProcess(): ChildProcess & {
  listeners: Map<string, Listener>;
  stdoutListeners: Map<string, Listener>;
  stderrListeners: Map<string, Listener>;
} {
  const listeners = new Map<string, Listener>();
  const stdoutListeners = new Map<string, Listener>();
  const stderrListeners = new Map<string, Listener>();
  const proc = {
    pid: 1234,
    killed: false,
    kill: vi.fn(),
    stdout: {
      on: vi.fn((event: string, cb: Listener) => stdoutListeners.set(event, cb)),
    },
    stderr: {
      on: vi.fn((event: string, cb: Listener) => stderrListeners.set(event, cb)),
    },
    on: vi.fn((event: string, cb: Listener) => {
      listeners.set(event, cb);
      return proc;
    }),
    once: vi.fn(),
    listeners,
    stdoutListeners,
    stderrListeners,
  };
  return proc as unknown as ChildProcess & {
    listeners: Map<string, Listener>;
    stdoutListeners: Map<string, Listener>;
    stderrListeners: Map<string, Listener>;
  };
}

describe('Editor MCP Tools', () => {
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
    registerEditorTools(server, ctx);
  });

  // ── launch_editor ────────────────────────────────────────────────────

  describe('launch_editor', () => {
    it('registers the launch_editor tool', () => {
      expect(handlers.has('launch_editor')).toBe(true);
    });

    it('spawns the Godot editor with -e --path and returns success text', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(proc);

      const handler = handlers.get('launch_editor')!;
      const result = await handler({ project_path: '/my/project' }) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/godot',
        ['-e', '--path', '/my/project'],
        { stdio: 'pipe' },
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Godot editor launched successfully');
      expect(result.content[0].text).toContain('/my/project');
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('launch_editor')!;
      const result = await handler({ project_path: '/bad/../path' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns toolError when project.godot is missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('launch_editor')!;
      const result = await handler({ project_path: '/not/a/project' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('Not a valid Godot project'),
        expect.any(Array),
      );
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns toolError when spawn throws', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: godot not found');
      });

      const handler = handlers.get('launch_editor')!;
      const result = await handler({ project_path: '/my/project' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('ENOENT: godot not found'),
        expect.any(Array),
      );
    });
  });

  // ── run_project ──────────────────────────────────────────────────────

  describe('run_project', () => {
    it('registers the run_project tool', () => {
      expect(handlers.has('run_project')).toBe(true);
    });

    it('spawns Godot in debug mode, tracks the process, and returns success text', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(proc);

      const handler = handlers.get('run_project')!;
      const result = await handler({ project_path: '/my/project' }) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/godot',
        ['-d', '--path', '/my/project'],
        { stdio: 'pipe' },
      );
      expect(ctx.activeProcess).not.toBeNull();
      expect(ctx.activeProcess!.process).toBe(proc);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('get_debug_output');
    });

    it('appends the scene argument when a valid scene is given', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(createMockProcess());

      const handler = handlers.get('run_project')!;
      await handler({ project_path: '/my/project', scene: 'scenes/main.tscn' });

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/godot',
        ['-d', '--path', '/my/project', 'scenes/main.tscn'],
        { stdio: 'pipe' },
      );
    });

    it('kills an existing active process before starting a new one', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      const oldProc = createMockProcess();
      ctx.activeProcess = { process: oldProc, output: [], errors: [] };
      const newProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(newProc);

      const handler = handlers.get('run_project')!;
      await handler({ project_path: '/my/project' });

      expect(oldProc.kill).toHaveBeenCalled();
      expect(ctx.activeProcess!.process).toBe(newProc);
    });

    it('accumulates stdout/stderr lines into the active process buffers', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(proc);

      const handler = handlers.get('run_project')!;
      await handler({ project_path: '/my/project' });

      proc.stdoutListeners.get('data')!(Buffer.from('hello world\n'));
      proc.stderrListeners.get('data')!(Buffer.from('SCRIPT ERROR: oops\n'));

      expect(ctx.activeProcess!.output).toContain('hello world');
      expect(ctx.activeProcess!.errors).toContain('SCRIPT ERROR: oops');
    });

    it('clears activeProcess when the process exits', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(proc);

      const handler = handlers.get('run_project')!;
      await handler({ project_path: '/my/project' });
      expect(ctx.activeProcess).not.toBeNull();

      proc.listeners.get('exit')!(0);
      expect(ctx.activeProcess).toBeNull();
    });

    it('returns toolError when validatePath fails', async () => {
      vi.mocked(validatePath).mockReturnValue(false);

      const handler = handlers.get('run_project')!;
      const result = await handler({ project_path: '/bad/../path' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns toolError when project.godot is missing', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = handlers.get('run_project')!;
      const result = await handler({ project_path: '/not/a/project' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns toolError when spawn throws', async () => {
      vi.mocked(validatePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('spawn EACCES');
      });

      const handler = handlers.get('run_project')!;
      const result = await handler({ project_path: '/my/project' }) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('spawn EACCES'),
        expect.any(Array),
      );
    });
  });

  // ── get_debug_output ─────────────────────────────────────────────────

  describe('get_debug_output', () => {
    it('registers the get_debug_output tool', () => {
      expect(handlers.has('get_debug_output')).toBe(true);
    });

    it('returns the active process output and errors as JSON', async () => {
      ctx.activeProcess = {
        process: createMockProcess(),
        output: ['line one', 'line two'],
        errors: ['ERROR: bad thing'],
      };

      const handler = handlers.get('get_debug_output')!;
      const result = await handler({}) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output).toEqual(['line one', 'line two']);
      expect(parsed.errors).toEqual(['ERROR: bad thing']);
    });

    it('returns toolError when no process is active', async () => {
      ctx.activeProcess = null;

      const handler = handlers.get('get_debug_output')!;
      const result = await handler({}) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('No active Godot process'),
        expect.any(Array),
      );
    });
  });

  // ── stop_project ─────────────────────────────────────────────────────

  describe('stop_project', () => {
    it('registers the stop_project tool', () => {
      expect(handlers.has('stop_project')).toBe(true);
    });

    it('kills the active process, clears it, and returns the final output', async () => {
      const proc = createMockProcess();
      ctx.activeProcess = {
        process: proc,
        output: ['final line'],
        errors: ['final error'],
      };

      const handler = handlers.get('stop_project')!;
      const result = await handler({}) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };

      expect(proc.kill).toHaveBeenCalled();
      expect(ctx.activeProcess).toBeNull();
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toBe('Godot project stopped');
      expect(parsed.finalOutput).toEqual(['final line']);
      expect(parsed.finalErrors).toEqual(['final error']);
    });

    it('returns toolError when no process is active', async () => {
      ctx.activeProcess = null;

      const handler = handlers.get('stop_project')!;
      const result = await handler({}) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(toolError).toHaveBeenCalledWith(
        expect.stringContaining('No active Godot process to stop'),
        expect.any(Array),
      );
    });
  });
});
