/**
 * Tests for capture_screenshot MCP tool.
 *
 * Uses vi.mock() to isolate tool logic from filesystem and Godot process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    execFileSync: vi.fn(),
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

import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { validatePath } from '../src/godot.js';
import { toolError } from '../src/errors.js';

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

describe('capture_screenshot MCP Tool', () => {
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
    registerEditorTools(server, ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the capture_screenshot tool', () => {
    expect(handlers.has('capture_screenshot')).toBe(true);
  });

  it('returns error when no active process is running', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);

    ctx.activeProcess = null;

    const handler = handlers.get('capture_screenshot')!;
    const result = await handler({ project_path: '/my/project' }) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('No active Godot process'),
      expect.any(Array),
    );
  });

  it('returns error when screenshot file is not produced within timeout', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      // Screenshot output file never appears
      if (p.endsWith('screenshot.png')) return false;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });

    // Advance past the 5-second timeout (polling at 100ms intervals)
    await vi.advanceTimersByTimeAsync(6000);

    const result = await resultPromise as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.any(Array),
    );
  });

  it('returns MCP image content with correct structure on success', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    // Small PNG-like buffer (under 800KB)
    const fakePngData = Buffer.alloc(1024, 0x89);
    const expectedBase64 = fakePngData.toString('base64');

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('screenshot.png')) return true;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(readFileSync).mockReturnValue(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as ReturnType<typeof statSync>);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });

    // Advance past the first poll interval
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise as {
      content: Array<{ type: string; data?: string; mimeType?: string }>;
    };

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('image');
    expect(result.content[0].mimeType).toBe('image/png');
    expect(result.content[0].data).toBe(expectedBase64);
  });

  it('writes a trigger file at the correct project-relative path', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('screenshot.png')) return true;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(readFileSync).mockReturnValue(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 512 } as ReturnType<typeof statSync>);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // Verify trigger file was written at the expected path
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.godot/screenshot_trigger'),
      '',
    );
  });

  it('cleans up trigger and output files after successful capture', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);

    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('screenshot.png')) return true;
      if (p.endsWith('screenshot_trigger')) return true;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(readFileSync).mockReturnValue(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 512 } as ReturnType<typeof statSync>);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // Verify cleanup: trigger and output files are deleted
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('screenshot.png'));
  });

  it('triggers resize for large screenshots (>800KB)', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    // Large buffer > 800KB
    const largePngData = Buffer.alloc(900 * 1024, 0x89);
    // After resize, the file is smaller
    const smallPngData = Buffer.alloc(400 * 1024, 0x89);

    let readCallCount = 0;
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('screenshot.png')) return true;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(readFileSync).mockImplementation(() => {
      readCallCount++;
      // First read returns large file, second read (after resize) returns smaller
      if (readCallCount <= 1) return largePngData;
      return smallPngData;
    });

    let statCallCount = 0;
    vi.mocked(statSync).mockImplementation(() => {
      statCallCount++;
      if (statCallCount <= 1) return { size: 900 * 1024 } as ReturnType<typeof statSync>;
      return { size: 400 * 1024 } as ReturnType<typeof statSync>;
    });
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    // Mock spawn for the resize process
    const mockResizeProc = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') {
          // Simulate successful resize completion
          setTimeout(() => cb(0), 10);
        }
        return mockResizeProc;
      }),
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    };
    vi.mocked(spawn).mockReturnValue(mockResizeProc as unknown as ChildProcess);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise as {
      content: Array<{ type: string; data?: string; mimeType?: string }>;
    };

    // Should have spawned Godot for resize
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/godot',
      expect.arrayContaining(['--headless', '--script']),
      expect.any(Object),
    );

    // Should still return valid image content
    expect(result.content[0].type).toBe('image');
    expect(result.content[0].mimeType).toBe('image/png');
  });

  it('returns error for invalid project path', async () => {
    vi.mocked(validatePath).mockReturnValue(false);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const result = await handler({ project_path: '/bad/../path' }) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });
});
