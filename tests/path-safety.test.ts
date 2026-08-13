/**
 * Tests for path-safety helpers: resolveWithinProject (src/godot.ts) and
 * ensureProject (src/tools/common.ts).
 *
 * Uses real temporary directories/symlinks on disk rather than mocking fs, since
 * containment checks depend on real filesystem resolution (realpath) semantics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveWithinProject } from '../src/godot.js';
import {
  ensureProject,
  withProject,
  opSuccess,
  outsideProjectError,
  GODOT_ENV_SUGGESTIONS,
} from '../src/tools/common.js';

describe('resolveWithinProject', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'godot-mcp-root-'));
    outside = mkdtempSync(join(tmpdir(), 'godot-mcp-outside-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('resolves a simple relative path inside the project', () => {
    writeFileSync(join(root, 'scene.tscn'), 'content');
    const result = resolveWithinProject(root, 'scene.tscn');
    expect(result).toBe(join(root, 'scene.tscn'));
  });

  it('rejects a ".." escape', () => {
    const result = resolveWithinProject(root, '../etc/passwd');
    expect(result).toBeNull();
  });

  it('rejects an absolute path outside the root', () => {
    const result = resolveWithinProject(root, outside);
    expect(result).toBeNull();
  });

  it('rejects a null byte in the path', () => {
    const result = resolveWithinProject(root, 'scene\0.tscn');
    expect(result).toBeNull();
  });

  it('rejects a symlink that points outside the project root', () => {
    const linkPath = join(root, 'escape_link');
    symlinkSync(outside, linkPath);
    const result = resolveWithinProject(root, 'escape_link');
    expect(result).toBeNull();
  });

  it('resolves a not-yet-existing output path under the root', () => {
    const result = resolveWithinProject(root, 'output/new_file.tres');
    expect(result).toBe(join(root, 'output', 'new_file.tres'));
  });

  it('strips a res:// prefix before resolving', () => {
    writeFileSync(join(root, 'scene.tscn'), 'content');
    const result = resolveWithinProject(root, 'res://scene.tscn');
    expect(result).toBe(join(root, 'scene.tscn'));
  });

  it('resolves the root itself', () => {
    const result = resolveWithinProject(root, '.');
    expect(result).toBe(root);
  });

  describe('when projectRoot itself is reached through a symlink', () => {
    let realDir: string;
    let symlinkRoot: string;

    beforeEach(() => {
      realDir = mkdtempSync(join(tmpdir(), 'godot-mcp-real-'));
      symlinkRoot = join(tmpdir(), `godot-mcp-symlink-root-${process.pid}-${Date.now()}`);
      symlinkSync(realDir, symlinkRoot);
    });

    afterEach(() => {
      rmSync(symlinkRoot, { force: true });
      rmSync(realDir, { recursive: true, force: true });
    });

    it('resolves an existing in-project file without spuriously rejecting it', () => {
      writeFileSync(join(realDir, 'scene.tscn'), 'content');
      const result = resolveWithinProject(symlinkRoot, 'scene.tscn');
      expect(result).toBe(join(realpathSync(realDir), 'scene.tscn'));
    });

    it('resolves a not-yet-existing output path without spuriously rejecting it', () => {
      const result = resolveWithinProject(symlinkRoot, 'output/new_file.tres');
      expect(result).toBe(join(realpathSync(realDir), 'output', 'new_file.tres'));
    });

    it('still rejects a ".." escape reached through the symlinked root', () => {
      const result = resolveWithinProject(symlinkRoot, '../etc/passwd');
      expect(result).toBeNull();
    });
  });
});

describe('ensureProject', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'godot-mcp-project-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an error response for an invalid path', () => {
    const result = ensureProject('../escape');
    expect(result).not.toBeNull();
    expect(result?.isError).toBe(true);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error).toBe('Invalid path');
  });

  it('returns an error response when project.godot is missing', () => {
    const result = ensureProject(root);
    expect(result).not.toBeNull();
    expect(result?.isError).toBe(true);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error).toMatch(/Not a valid Godot project/);
  });

  it('returns null for a valid project directory', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'project.godot'), '[application]\n');
    const result = ensureProject(root);
    expect(result).toBeNull();
  });
});

describe('withProject', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'godot-mcp-wrap-'));
    writeFileSync(join(root, 'project.godot'), '[application]\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function parseError(result: { content: Array<{ text: string }> }) {
    return JSON.parse(result.content[0].text) as { error: string; suggestions: string[] };
  }

  it('calls the handler with the original args for a valid project', async () => {
    const handler = withProject<{ project_path: string; extra: number }>(
      { catchPrefix: 'Failed' },
      async (args) => ({ content: [{ type: 'text' as const, text: `ok:${args.extra}` }] }),
    );
    const result = await handler({ project_path: root, extra: 42 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('ok:42');
  });

  it('rejects an invalid project_path before the handler runs', async () => {
    const handler = vi.fn();
    const wrapped = withProject({ catchPrefix: 'Failed' }, handler);
    const result = await wrapped({ project_path: '../escape' });
    expect(result.isError).toBe(true);
    expect(parseError(result).error).toBe('Invalid path');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects invalid extraPaths with the standard Invalid path error', async () => {
    const handler = vi.fn();
    const wrapped = withProject<{ project_path: string; scene_path: string }>(
      { catchPrefix: 'Failed', extraPaths: (a) => [a.scene_path] },
      handler,
    );
    const result = await wrapped({ project_path: root, scene_path: '../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(parseError(result).error).toBe('Invalid path');
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips undefined extraPaths entries (optional params)', async () => {
    const wrapped = withProject<{ project_path: string; new_path?: string }>(
      { catchPrefix: 'Failed', extraPaths: (a) => [a.new_path] },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );
    const result = await wrapped({ project_path: root });
    expect(result.isError).toBeUndefined();
  });

  it('returns Not a valid Godot project when project.godot is missing', async () => {
    const handler = vi.fn();
    const empty = mkdtempSync(join(tmpdir(), 'godot-mcp-empty-'));
    try {
      const wrapped = withProject({ catchPrefix: 'Failed' }, handler);
      const result = await wrapped({ project_path: empty });
      expect(result.isError).toBe(true);
      expect(parseError(result).error).toMatch(/Not a valid Godot project/);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('converts a thrown error into the catch triad with default suggestions', async () => {
    const wrapped = withProject({ catchPrefix: 'Failed to frob' }, async () => {
      throw new Error('kaboom');
    });
    const result = await wrapped({ project_path: root });
    expect(result.isError).toBe(true);
    const parsed = parseError(result);
    expect(parsed.error).toBe('Failed to frob: kaboom');
    expect(parsed.suggestions).toEqual(GODOT_ENV_SUGGESTIONS);
  });

  it('uses custom catchSuggestions and handles non-Error throws', async () => {
    const wrapped = withProject(
      { catchPrefix: 'Failed to frob', catchSuggestions: ['Do the thing'] },
      async () => {
        throw 'string-throw';
      },
    );
    const result = await wrapped({ project_path: root });
    const parsed = parseError(result);
    expect(parsed.error).toBe('Failed to frob: Unknown error');
    expect(parsed.suggestions).toEqual(['Do the thing']);
  });
});

describe('response helpers', () => {
  it('opSuccess pretty-prints the payload', () => {
    const result = opSuccess('Done', { a: 1 });
    expect(result.content[0].text).toBe('Done\n\nOutput: {\n  "a": 1\n}');
    expect(result.isError).toBeUndefined();
  });

  it('opSuccess never renders "Output: undefined" for missing data', () => {
    const result = opSuccess('Done', undefined);
    expect(result.content[0].text).toBe('Done\n\nOutput: {}');
    expect(result.content[0].text).not.toContain('undefined');
  });

  it('outsideProjectError names the offending parameter', () => {
    const result = outsideProjectError('scene_path');
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as { error: string };
    expect(parsed.error).toBe('Invalid scene_path: path resolves outside the project directory');
  });
});
