/**
 * Tests for capture_screenshot MCP tool.
 *
 * Screenshot capture routes through the shared RuntimeHelper IPC channel
 * (triggerAndPoll): a JSON command trigger at .godot/runtime_trigger, a JSON
 * response at .godot/runtime_result.json, and the PNG itself at
 * .godot/screenshot.png. Uses vi.mock() to isolate tool logic from
 * filesystem and Godot process.
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

// Mock godot module (keep the real parseOperationOutput — it is pure and the
// resize failure-path tests exercise its verdict handling)
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

/**
 * Path-keyed fs mocks for a successful IPC screenshot round-trip: the
 * RuntimeHelper "responds" on .godot/runtime_result.json and the PNG exists
 * at .godot/screenshot.png.
 */
function mockIpcScreenshotSuccess(pngData: Buffer): void {
  vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
    const p = String(path);
    if (p.endsWith('project.godot')) return true;
    if (p.endsWith('runtime_result.json')) return true;
    if (p.endsWith('screenshot.png')) return true;
    return false;
  });
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  vi.mocked(readFileSync).mockImplementation(((path: string | unknown) => {
    const p = String(path);
    if (p.endsWith('runtime_result.json')) {
      return '{"success": true, "path": "res://.godot/screenshot.png", "width": 1152, "height": 648}';
    }
    return pngData;
  }) as typeof readFileSync);
  vi.mocked(unlinkSync).mockReturnValue(undefined);
}

/**
 * Mock for the spawned resize_image.gd Godot process. Emits the given stdout/
 * stderr via 'data' events, then fires 'close' with the given exit code.
 * Uses setTimeout so it composes with vi.useFakeTimers().
 */
function createMockResizeProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): ChildProcess {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && opts.stdout) {
          setTimeout(() => cb(Buffer.from(opts.stdout!)), 5);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && opts.stderr) {
          setTimeout(() => cb(Buffer.from(opts.stderr!)), 5);
        }
      }),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(opts.exitCode ?? 0), 10);
      }
      return proc;
    }),
  };
  return proc as unknown as ChildProcess;
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

  it('returns error when the RuntimeHelper does not respond within the timeout', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      // IPC result file never appears
      if (p.endsWith('runtime_result.json')) return false;
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

  it('surfaces a structured helper error (e.g. headless capture) as a toolError', async () => {
    vi.mocked(validatePath).mockReturnValue(true);
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('runtime_result.json')) return true;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(readFileSync).mockImplementation((() =>
      '{"error": "Screenshot capture is not supported in headless mode (no rendering surface)"}') as unknown as typeof readFileSync);
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('not supported in headless mode'),
      expect.any(Array),
    );
  });

  it('returns MCP image content with correct structure on success', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    // Small PNG-like buffer (under 800KB)
    const fakePngData = Buffer.alloc(1024, 0x89);
    const expectedBase64 = fakePngData.toString('base64');

    mockIpcScreenshotSuccess(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as ReturnType<typeof statSync>);

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

  it('writes a JSON "screenshot" command to the shared runtime trigger file', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);
    mockIpcScreenshotSuccess(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 512 } as ReturnType<typeof statSync>);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // Same trigger channel as the inspect_* tools — no separate
    // screenshot_trigger file exists anymore.
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.godot/runtime_trigger'),
      JSON.stringify({ command: 'screenshot', params: {} }),
    );
    for (const call of vi.mocked(writeFileSync).mock.calls) {
      expect(String(call[0])).not.toContain('screenshot_trigger');
    }
  });

  it('cleans up the IPC files and the PNG after successful capture', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);
    mockIpcScreenshotSuccess(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 512 } as ReturnType<typeof statSync>);

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // Verify cleanup: IPC result + trigger (via triggerAndPoll) and the PNG
    const unlinked = vi.mocked(unlinkSync).mock.calls.map((call) => String(call[0]));
    expect(unlinked.some((p) => p.endsWith('runtime_result.json'))).toBe(true);
    expect(unlinked.some((p) => p.endsWith('runtime_trigger'))).toBe(true);
    expect(unlinked.some((p) => p.endsWith('screenshot.png'))).toBe(true);
  });

  it('triggers resize for large screenshots (>800KB)', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    // Large buffer > 800KB
    const largePngData = Buffer.alloc(900 * 1024, 0x89);
    // After resize, the file is smaller
    const smallPngData = Buffer.alloc(400 * 1024, 0x89);

    let pngReadCount = 0;
    vi.mocked(existsSync).mockImplementation((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('project.godot')) return true;
      if (p.endsWith('runtime_result.json')) return true;
      if (p.endsWith('screenshot.png')) return true;
      return false;
    });
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(readFileSync).mockImplementation(((path: string | unknown) => {
      const p = String(path);
      if (p.endsWith('runtime_result.json')) return '{"success": true}';
      pngReadCount++;
      // First read returns large file, second read (after resize) returns smaller
      if (pngReadCount <= 1) return largePngData;
      return smallPngData;
    }) as typeof readFileSync);

    let statCallCount = 0;
    vi.mocked(statSync).mockImplementation(() => {
      statCallCount++;
      if (statCallCount <= 1) return { size: 900 * 1024 } as ReturnType<typeof statSync>;
      return { size: 400 * 1024 } as ReturnType<typeof statSync>;
    });
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    // Mock spawn for the resize process
    vi.mocked(spawn).mockReturnValue(
      createMockResizeProcess({
        stdout: '{"success": true, "image_path": "/my/project/.godot/screenshot.png", "width": 960, "height": 540}\n',
        exitCode: 0,
      }),
    );

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

  it('passes the static resize script and image path as positional argv (no interpolation)', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);
    mockIpcScreenshotSuccess(fakePngData);
    // Large first stat triggers resize; second stat is post-resize
    let statCallCount = 0;
    vi.mocked(statSync).mockImplementation(() => {
      statCallCount++;
      if (statCallCount <= 1) return { size: 900 * 1024 } as ReturnType<typeof statSync>;
      return { size: 400 * 1024 } as ReturnType<typeof statSync>;
    });

    vi.mocked(spawn).mockReturnValue(
      createMockResizeProcess({ stdout: '{"success": true}\n', exitCode: 0 }),
    );

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // Exact argv: static script (sibling of operationsScriptPath), then
    // image path / width / height as positional args — no generated source.
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/godot',
      [
        '--headless',
        '--script',
        '/path/to/resize_image.gd',
        '/my/project/.godot/screenshot.png',
        '960',
        '540',
      ],
      { stdio: 'pipe' },
    );
  });

  it('never writes a temp .gd script during resize', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);
    mockIpcScreenshotSuccess(fakePngData);
    let statCallCount = 0;
    vi.mocked(statSync).mockImplementation(() => {
      statCallCount++;
      if (statCallCount <= 1) return { size: 900 * 1024 } as ReturnType<typeof statSync>;
      return { size: 400 * 1024 } as ReturnType<typeof statSync>;
    });

    vi.mocked(spawn).mockReturnValue(
      createMockResizeProcess({ stdout: '{"success": true}\n', exitCode: 0 }),
    );

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // The only writeFileSync call is the IPC trigger file — no generated
    // .gd script is ever written or cleaned up.
    for (const call of vi.mocked(writeFileSync).mock.calls) {
      expect(String(call[0])).not.toMatch(/\.gd$/);
    }
    for (const call of vi.mocked(unlinkSync).mock.calls) {
      expect(String(call[0])).not.toMatch(/\.gd$/);
    }
  });

  it('returns an error when the resize script reports a JSON failure verdict', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);
    mockIpcScreenshotSuccess(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 900 * 1024 } as ReturnType<typeof statSync>);

    vi.mocked(spawn).mockReturnValue(
      createMockResizeProcess({
        stdout: '{"success": false, "error": "Failed to load image: /my/project/.godot/screenshot.png"}\n',
        stderr: '[ERROR] Failed to load image\n',
        exitCode: 1,
      }),
    );

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load image'),
      expect.any(Array),
    );
  });

  it('returns an error when the resize process exits non-zero without JSON output', async () => {
    vi.mocked(validatePath).mockReturnValue(true);

    const fakePngData = Buffer.alloc(512, 0x89);
    mockIpcScreenshotSuccess(fakePngData);
    vi.mocked(statSync).mockReturnValue({ size: 900 * 1024 } as ReturnType<typeof statSync>);

    vi.mocked(spawn).mockReturnValue(
      createMockResizeProcess({ stderr: 'godot crashed hard\n', exitCode: 1 }),
    );

    const mockProc = createMockProcess();
    ctx.activeProcess = { process: mockProc, output: [], errors: [] };

    const handler = handlers.get('capture_screenshot')!;
    const resultPromise = handler({ project_path: '/my/project' });
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(toolError).toHaveBeenCalledWith(
      expect.stringContaining('godot crashed hard'),
      expect.any(Array),
    );
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
