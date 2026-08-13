/**
 * Tests for the bounded process-output window (appendCapped /
 * MAX_PROCESS_OUTPUT_LINES in src/tools/common.ts).
 */

import { describe, it, expect } from 'vitest';
import { appendCapped, MAX_PROCESS_OUTPUT_LINES } from '../src/tools/common.js';

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
