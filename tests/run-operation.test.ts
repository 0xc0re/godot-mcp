/**
 * Tests for parseOperationOutput: the shared verdict logic that decides whether a
 * Godot operation succeeded or failed from its stdout/stderr/exit code.
 *
 * Pure function - no mocking of ../src/godot.js needed.
 */

import { describe, it, expect } from 'vitest';
import { parseOperationOutput } from '../src/godot.js';

describe('parseOperationOutput', () => {
  it('treats trailing success JSON as authoritative', () => {
    const result = parseOperationOutput('{"success":true,"path":"res://x.tscn"}', '', 0);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ success: true, path: 'res://x.tscn' });
  });

  it('extracts the error message from trailing failure JSON', () => {
    const result = parseOperationOutput(
      '{"success":false,"error":"Node not found: /root/Foo"}',
      '',
      0,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Node not found: /root/Foo');
  });

  it('picks the last JSON verdict when debug/info noise lines follow it', () => {
    const stdout = [
      '{"success":true,"value":1}',
      '[DEBUG] cleaning up',
      '[INFO] done',
    ].join('\n');
    const result = parseOperationOutput(stdout, '', 0);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ success: true, value: 1 });
  });

  it('scans past noise lines that appear before the JSON verdict', () => {
    const stdout = ['[INFO] starting', '[DEBUG] working', '{"success":true}'].join('\n');
    const result = parseOperationOutput(stdout, '', 0);
    expect(result.ok).toBe(true);
  });

  it('prefers the last of two success JSON lines when later non-JSON noise follows', () => {
    const stdout = ['{"success":true,"n":1}', 'some trailing plain-text noise'].join('\n');
    const result = parseOperationOutput(stdout, '', 0);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ success: true, n: 1 });
  });

  it('falls back to a stderr-derived error when there is no JSON and exit code is non-zero', () => {
    const stderr = ['some GDScript warning', 'ERROR: Failed to load resource'].join('\n');
    const result = parseOperationOutput('', stderr, 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ERROR: Failed to load resource');
  });

  it('is ok when there is no JSON, exit code is 0, and stderr is clean', () => {
    const result = parseOperationOutput('some plain stdout', '', 0);
    expect(result.ok).toBe(true);
  });

  it('fails when exit is 0, there is no JSON, but stderr has an [ERROR] marker', () => {
    const stderr = '[ERROR] Something went wrong internally';
    const result = parseOperationOutput('', stderr, 0);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('[ERROR] Something went wrong internally');
  });

  it('fails when exit is 0, there is no JSON, but stderr has a "Failed to " line', () => {
    const stderr = 'Failed to save scene to disk';
    const result = parseOperationOutput('', stderr, 0);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Failed to save scene to disk');
  });

  it('is ok when exit is 0, there is no JSON, and stderr only has warnings', () => {
    const stderr = 'WARNING: deprecated call\nWARNING: another notice';
    const result = parseOperationOutput('', stderr, 0);
    expect(result.ok).toBe(true);
  });

  it('skips a malformed JSON-looking line and falls through to the next tier', () => {
    const stdout = '{success: true, unquoted: keys}'; // invalid JSON (unquoted keys)
    const result = parseOperationOutput(stdout, '', 0);
    expect(result.ok).toBe(true); // exit 0, no valid JSON verdict, no stderr markers
  });

  it('handles completely empty stdout and stderr with exit code 0', () => {
    const result = parseOperationOutput('', '', 0);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('handles completely empty stdout and stderr with a non-zero exit code', () => {
    const result = parseOperationOutput('', '', 1);
    expect(result.ok).toBe(false);
  });

  it('treats a null exit code with no JSON and no stderr markers as ok', () => {
    const result = parseOperationOutput('plain output', 'plain stderr', null);
    expect(result.ok).toBe(true);
  });

  it('does not treat a null exit code as a failing exit code', () => {
    // exitCode null must NOT trigger tier 2 (which requires exitCode !== null).
    const result = parseOperationOutput('', 'some harmless stderr', null);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('passes the parsed JSON payload through as data on success', () => {
    const payload = { success: true, nodes: ['A', 'B'], count: 2 };
    const result = parseOperationOutput(JSON.stringify(payload), '', 0);
    expect(result.data).toEqual(payload);
  });

  it('always echoes back stdout, stderr, and exitCode verbatim', () => {
    const result = parseOperationOutput('out', 'err', 7);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(7);
  });

  it('treats an error key with no success key as a failure verdict', () => {
    const result = parseOperationOutput('{"error":"boom"}', '', 0);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('truncates very long stderr-derived error messages to a reasonable length', () => {
    const longLine = 'x'.repeat(2000);
    const result = parseOperationOutput('', longLine, 1);
    expect(result.ok).toBe(false);
    expect(result.error!.length).toBeLessThan(600);
  });
});
