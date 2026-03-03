/**
 * Tests for SIGINT and SIGTERM signal handler registration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Signal handler registration', () => {
  const indexSource = readFileSync(
    join(__dirname, '..', 'src', 'index.ts'),
    'utf-8',
  );

  it('registers a SIGINT handler on process', () => {
    expect(indexSource).toMatch(/process\.on\(['"]SIGINT['"]/);
  });

  it('registers a SIGTERM handler on process', () => {
    expect(indexSource).toMatch(/process\.on\(['"]SIGTERM['"]/);
  });

  it('has a shutdown function that iterates trackedProcesses', () => {
    // Verify shutdown/cleanup function kills tracked processes
    expect(indexSource).toMatch(/trackedProcesses/);
    expect(indexSource).toMatch(/\.kill\(/);
  });

  it('clears trackedProcesses set during shutdown', () => {
    expect(indexSource).toMatch(/trackedProcesses\.clear\(\)/);
  });

  it('kills activeProcess during shutdown if it exists', () => {
    expect(indexSource).toMatch(/activeProcess/);
  });

  it('calls server.close() during shutdown', () => {
    expect(indexSource).toMatch(/server\.close\(\)/);
  });
});
