/**
 * Tests for process execution hardening: maxBuffer, timeout, and process tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ServerContext } from '../src/types.js';

// Mock child_process before importing the module under test
vi.mock('child_process', () => {
  const mockExecFile = vi.fn(
    (
      _path: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, 'mock stdout', 'mock stderr');
    },
  );
  return {
    execFile: mockExecFile,
    spawn: vi.fn(),
  };
});

/** Helper to create a minimal ServerContext for testing */
function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/script.gd',
    activeProcess: null,
    trackedProcesses: new Set<ChildProcess>(),
    validatedPaths: new Map<string, boolean>(),
  };
}

describe('execGodot process hardening', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes maxBuffer of 10MB (10485760) to execFileAsync', async () => {
    const { execFile } = await import('child_process');
    const { execGodot } = await import('../src/godot.js');

    await execGodot('/usr/bin/godot', ['--version']);

    expect(execFile).toHaveBeenCalled();
    const callArgs = vi.mocked(execFile).mock.calls[0];
    // execFile(path, args, options, callback) -- options is the 3rd argument
    const options = callArgs[2] as Record<string, unknown>;
    expect(options).toBeDefined();
    expect(options.maxBuffer).toBe(10 * 1024 * 1024);
  });

  it('passes timeout of 30000ms to execFileAsync', async () => {
    const { execFile } = await import('child_process');
    const { execGodot } = await import('../src/godot.js');

    await execGodot('/usr/bin/godot', ['--version']);

    expect(execFile).toHaveBeenCalled();
    const callArgs = vi.mocked(execFile).mock.calls[0];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options).toBeDefined();
    expect(options.timeout).toBe(30_000);
  });
});

describe('executeOperation process hardening', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes maxBuffer and timeout to execFileAsync', async () => {
    const { execFile } = await import('child_process');
    const { executeOperation } = await import('../src/godot.js');

    const ctx = createTestContext();

    await executeOperation(ctx, '/project', 'test_op', { key: 'value' });

    expect(execFile).toHaveBeenCalled();
    const callArgs = vi.mocked(execFile).mock.calls[0];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options).toBeDefined();
    expect(options.maxBuffer).toBe(10 * 1024 * 1024);
    expect(options.timeout).toBe(30_000);
  });

  it('honors a per-operation timeout override', async () => {
    const { execFile } = await import('child_process');
    const { executeOperation } = await import('../src/godot.js');

    const ctx = createTestContext();

    await executeOperation(ctx, '/project', 'resave_resources', {}, { timeout: 120_000 });

    const callArgs = vi.mocked(execFile).mock.lastCall!;
    const options = callArgs[2] as Record<string, unknown>;
    expect(options.timeout).toBe(120_000);
  });

  it('runOperation passes the timeout override through to executeOperation', async () => {
    const { execFile } = await import('child_process');
    const { runOperation } = await import('../src/godot.js');

    const ctx = createTestContext();

    await runOperation(ctx, '/project', 'export_mesh_library', {}, { timeout: 90_000 });

    const callArgs = vi.mocked(execFile).mock.lastCall!;
    const options = callArgs[2] as Record<string, unknown>;
    expect(options.timeout).toBe(90_000);
  });

  it('snake_cases camelCase keys inside arrays of objects (array recursion)', async () => {
    const { execFile } = await import('child_process');
    const { executeOperation } = await import('../src/godot.js');

    const ctx = createTestContext();

    await executeOperation(ctx, '/project', 'batch_set_properties', {
      scenePath: 'scenes/main.tscn',
      operations: [
        { nodePath: '.', propertyName: 'collision_layer', value: 1 },
        { nested: { innerKey: [{ deepKey: 2 }] } },
      ],
    });

    const callArgs = vi.mocked(execFile).mock.lastCall!;
    const args = callArgs[1] as string[];
    const paramsJson = args[args.length - 1];
    const params = JSON.parse(paramsJson);
    expect(params).toEqual({
      scene_path: 'scenes/main.tscn',
      operations: [
        { node_path: '.', property_name: 'collision_layer', value: 1 },
        { nested: { inner_key: [{ deep_key: 2 }] } },
      ],
    });
  });
});

describe('trackProcess', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds process to trackedProcesses set', async () => {
    const { trackProcess } = await import('../src/godot.js');

    const ctx = createTestContext();
    const mockProc = new EventEmitter() as unknown as ChildProcess;

    trackProcess(ctx, mockProc);
    expect(ctx.trackedProcesses.has(mockProc)).toBe(true);
  });

  it('removes process from set on exit event', async () => {
    const { trackProcess } = await import('../src/godot.js');

    const ctx = createTestContext();
    const mockProc = new EventEmitter() as unknown as ChildProcess;

    trackProcess(ctx, mockProc);
    expect(ctx.trackedProcesses.has(mockProc)).toBe(true);

    // Emit exit event
    mockProc.emit('exit', 0, null);
    expect(ctx.trackedProcesses.has(mockProc)).toBe(false);
  });

  it('removes process from set on error event', async () => {
    const { trackProcess } = await import('../src/godot.js');

    const ctx = createTestContext();
    const mockProc = new EventEmitter() as unknown as ChildProcess;

    trackProcess(ctx, mockProc);
    expect(ctx.trackedProcesses.has(mockProc)).toBe(true);

    // Emit error event
    mockProc.emit('error', new Error('test error'));
    expect(ctx.trackedProcesses.has(mockProc)).toBe(false);
  });

  it('returns the process for chaining', async () => {
    const { trackProcess } = await import('../src/godot.js');

    const ctx = createTestContext();
    const mockProc = new EventEmitter() as unknown as ChildProcess;

    const result = trackProcess(ctx, mockProc);
    expect(result).toBe(mockProc);
  });
});
