/**
 * Tests for the bounded process-output window (appendCapped /
 * MAX_PROCESS_OUTPUT_LINES in src/tools/common.ts).
 */

import { describe, it, expect } from 'vitest';
import type { ChildProcess } from 'child_process';
import type { GodotProcess } from '../src/types.js';
import {
  appendCapped,
  appendProcessOutput,
  MAX_PROCESS_OUTPUT_LINES,
} from '../src/tools/common.js';

describe('appendCapped', () => {
  it('appends normally while under the cap', () => {
    const buffer: string[] = ['a'];
    appendCapped(buffer, ['b', 'c'], 10);
    expect(buffer).toEqual(['a', 'b', 'c']);
  });

  it('drops the OLDEST lines once the cap is exceeded', () => {
    const buffer = ['old1', 'old2', 'old3'];
    appendCapped(buffer, ['new1', 'new2'], 3);
    expect(buffer).toEqual(['old3', 'new1', 'new2']);
  });

  it('keeps exactly the cap when a single chunk exceeds it', () => {
    const buffer: string[] = [];
    const lines = Array.from({ length: 25 }, (_, i) => `line-${i}`);
    appendCapped(buffer, lines, 10);
    expect(buffer).toHaveLength(10);
    expect(buffer[0]).toBe('line-15');
    expect(buffer[9]).toBe('line-24');
  });

  it('mutates the buffer in place (shared via ctx.activeProcess)', () => {
    const buffer: string[] = [];
    const ref = buffer;
    appendCapped(buffer, ['x'], 5);
    expect(ref).toEqual(['x']);
  });

  it('defaults to MAX_PROCESS_OUTPUT_LINES (1000)', () => {
    expect(MAX_PROCESS_OUTPUT_LINES).toBe(1000);
    const buffer: string[] = [];
    appendCapped(buffer, Array.from({ length: 1500 }, (_, i) => `l${i}`));
    expect(buffer).toHaveLength(1000);
    expect(buffer[0]).toBe('l500');
    expect(buffer[999]).toBe('l1499');
  });
});

describe('appendProcessOutput', () => {
  function makeRecord(): GodotProcess {
    return {
      process: {} as ChildProcess,
      output: [],
      errors: [],
      combined: [],
      totalLines: 0,
    };
  }

  it('routes lines to the per-stream buffer and the combined interleave', () => {
    const procRecord = makeRecord();
    appendProcessOutput(procRecord, 'stdout', ['a']);
    appendProcessOutput(procRecord, 'stderr', ['b']);
    appendProcessOutput(procRecord, 'stdout', ['c']);

    expect(procRecord.output).toEqual(['a', 'c']);
    expect(procRecord.errors).toEqual(['b']);
    expect(procRecord.combined).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stderr', text: 'b' },
      { stream: 'stdout', text: 'c' },
    ]);
    expect(procRecord.totalLines).toBe(3);
  });

  it('keeps the monotonic counter growing while the window evicts old lines', () => {
    const procRecord = makeRecord();
    const lines = Array.from({ length: 1500 }, (_, i) => `l${i}`);
    appendProcessOutput(procRecord, 'stdout', lines);

    expect(procRecord.output).toHaveLength(MAX_PROCESS_OUTPUT_LINES);
    expect(procRecord.combined).toHaveLength(MAX_PROCESS_OUTPUT_LINES);
    expect(procRecord.combined![0]).toEqual({ stream: 'stdout', text: 'l500' });
    // Counter counts ALL lines ever captured, not just the retained window.
    expect(procRecord.totalLines).toBe(1500);
  });

  it('initializes combined/totalLines on records that lack them', () => {
    const procRecord: GodotProcess = {
      process: {} as ChildProcess,
      output: [],
      errors: [],
    };
    appendProcessOutput(procRecord, 'stderr', ['x']);
    expect(procRecord.combined).toEqual([{ stream: 'stderr', text: 'x' }]);
    expect(procRecord.totalLines).toBe(1);
  });
});
