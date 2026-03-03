/**
 * Tests for structured error responses.
 *
 * Verifies that toolError() returns a consistent JSON structure with
 * error message and suggestions array, and that all tool modules use it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { toolError } from '../src/errors.js';

describe('toolError structured responses', () => {
  it('returns object with content array containing JSON with error and suggestions keys', () => {
    const result = toolError('Something failed', ['Try X', 'Try Y']);

    expect(result.content).toBeInstanceOf(Array);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('error', 'Something failed');
    expect(parsed).toHaveProperty('suggestions');
    expect(parsed.suggestions).toEqual(['Try X', 'Try Y']);
  });

  it('sets isError to true on the response', () => {
    const result = toolError('Something failed', ['Try X']);
    expect(result.isError).toBe(true);
  });

  it('includes suggestions key even when empty', () => {
    const result = toolError('Fail', []);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('suggestions');
    expect(parsed.suggestions).toEqual([]);
  });

  it('returns parseable JSON in text content', () => {
    const result = toolError('Test error', ['suggestion 1', 'suggestion 2']);
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it('works with default empty suggestions when none provided', () => {
    const result = toolError('Error without suggestions');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('error', 'Error without suggestions');
    expect(parsed).toHaveProperty('suggestions');
    expect(parsed.suggestions).toEqual([]);
  });
});

describe('All tool modules use toolError for error paths', () => {
  const toolsDir = join(__dirname, '..', 'src', 'tools');
  const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith('.ts'));

  for (const file of toolFiles) {
    it(`${file} imports toolError from errors module`, () => {
      const source = readFileSync(join(toolsDir, file), 'utf-8');
      expect(source).toMatch(/import.*toolError.*from.*['"]\.\.\/errors/);
    });

    it(`${file} does not use ad-hoc error formatting (raw isError without toolError)`, () => {
      const source = readFileSync(join(toolsDir, file), 'utf-8');

      // Find all occurrences of isError: true that are not inside the toolError import
      // Ad-hoc would be: return { content: [...], isError: true } without using toolError
      const lines = source.split('\n');
      for (const line of lines) {
        if (line.includes('isError:') && !line.includes('toolError')) {
          // This would be an ad-hoc error pattern
          throw new Error(
            `Found ad-hoc isError pattern in ${file}: ${line.trim()}`,
          );
        }
      }
    });
  }
});
