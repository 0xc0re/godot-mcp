/**
 * Tests for process execution hardening: maxBuffer, timeout, and process tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
    const { ChildProcess } = await import('child_process');

    const ctx = {
      godotPath: '/usr/bin/godot',
      operationsScriptPath: '/path/to/script.gd',
      activeProcess: null,
      trackedProcesses: new Set() as Set<InstanceType<typeof ChildProcess>>,
      validatedPaths: new Map<string, boolean>(),
    };

    await executeOperation(ctx, '/project', 'test_op', { key: 'value' });

    expect(execFile).toHaveBeenCalled();
    const callArgs = vi.mocked(execFile).mock.calls[0];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options).toBeDefined();
    expect(options.maxBuffer).toBe(10 * 1024 * 1024);
    expect(options.timeout).toBe(30_000);
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
    const { ChildProcess } = await import('child_process');

    const trackedProcesses = new Set() as Set<InstanceType<typeof ChildProcess>>;
    const ctx = {
      godotPath: '/usr/bin/godot',
      operationsScriptPath: '/path/to/script.gd',
      activeProcess: null,
      trackedProcesses,
      validatedPaths: new Map<string, boolean>(),
    };

    // Create a mock process using EventEmitter
    const mockProc = new EventEmitter() as unknown as InstanceType<typeof ChildProcess>;

    trackProcess(ctx, mockProc);
    expect(trackedProcesses.has(mockProc)).toBe(true);
  });

  it('removes process from set on exit event', async () => {
    const { trackProcess } = await import('../src/godot.js');
    const { ChildProcess } = await import('child_process');

    const trackedProcesses = new Set() as Set<InstanceType<typeof ChildProcess>>;
    const ctx = {
      godotPath: '/usr/bin/godot',
      operationsScriptPath: '/path/to/script.gd',
      activeProcess: null,
      trackedProcesses,
      validatedPaths: new Map<string, boolean>(),
    };

    const mockProc = new EventEmitter() as unknown as InstanceType<typeof ChildProcess>;

    trackProcess(ctx, mockProc);
    expect(trackedProcesses.has(mockProc)).toBe(true);

    // Emit exit event
    mockProc.emit('exit', 0, null);
    expect(trackedProcesses.has(mockProc)).toBe(false);
  });

  it('removes process from set on error event', async () => {
    const { trackProcess } = await import('../src/godot.js');
    const { ChildProcess } = await import('child_process');

    const trackedProcesses = new Set() as Set<InstanceType<typeof ChildProcess>>;
    const ctx = {
      godotPath: '/usr/bin/godot',
      operationsScriptPath: '/path/to/script.gd',
      activeProcess: null,
      trackedProcesses,
      validatedPaths: new Map<string, boolean>(),
    };

    const mockProc = new EventEmitter() as unknown as InstanceType<typeof ChildProcess>;

    trackProcess(ctx, mockProc);
    expect(trackedProcesses.has(mockProc)).toBe(true);

    // Emit error event
    mockProc.emit('error', new Error('test error'));
    expect(trackedProcesses.has(mockProc)).toBe(false);
  });

  it('returns the process for chaining', async () => {
    const { trackProcess } = await import('../src/godot.js');
    const { ChildProcess } = await import('child_process');

    const trackedProcesses = new Set() as Set<InstanceType<typeof ChildProcess>>;
    const ctx = {
      godotPath: '/usr/bin/godot',
      operationsScriptPath: '/path/to/script.gd',
      activeProcess: null,
      trackedProcesses,
      validatedPaths: new Map<string, boolean>(),
    };

    const mockProc = new EventEmitter() as unknown as InstanceType<typeof ChildProcess>;

    const result = trackProcess(ctx, mockProc);
    expect(result).toBe(mockProc);
  });
});
