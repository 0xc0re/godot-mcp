/**
 * Tests for the Godot runtime log parser (src/parsers/godot-log-parser.ts).
 *
 * The fixtures in tests/fixtures/godot-log/ are REAL captured output from
 * Godot 4.7.1.stable.official.a13da4feb running a scratch project whose
 * script prints, push_warnings, push_errors, loads a missing resource
 * (engine error), and then hits a runtime script error:
 *
 *   godot --headless --path <proj>     -> stdout-plain.txt / stderr-plain.txt
 *   godot --headless -d --path <proj>  -> stdout-debug.txt / stderr-debug.txt
 *
 * The -d variant (what run_project actually passes) additionally captures
 * the local stdout debugger break block and the GDScript compile warning.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseGodotLog, type GodotLogEntry } from '../src/parsers/godot-log-parser.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'godot-log');

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf-8').split('\n');
}

describe('parseGodotLog', () => {
  // ── Real stderr fixture (plain headless run) ─────────────────────────

  describe('stderr-plain fixture (real Godot 4.7.1 stderr)', () => {
    const entries = parseGodotLog(fixtureLines('stderr-plain.txt'));

    it('groups the four blocks into four entries', () => {
      expect(entries).toHaveLength(4);
      expect(entries.map((e) => e.kind)).toEqual([
        'push_warning',
        'push_error',
        'engine',
        'script_error',
      ]);
    });

    it('parses the push_warning block with script/line from the backtrace', () => {
      const warning = entries[0];
      expect(warning.message).toBe('Watch out: this is a push_warning');
      expect(warning.script).toBe('res://main.gd');
      expect(warning.line).toBe(7);
      expect(warning.stack).toEqual([
        'at: push_warning (core/variant/variant_utility.cpp:1033)',
        '[0] _ready (res://main.gd:7)',
      ]);
    });

    it('parses the push_error block with script/line from the backtrace', () => {
      const error = entries[1];
      expect(error.kind).toBe('push_error');
      expect(error.message).toBe('Something failed: this is a push_error');
      expect(error.script).toBe('res://main.gd');
      expect(error.line).toBe(8);
    });

    it('classifies a core-engine ERROR block as engine, not push_error', () => {
      const engine = entries[2];
      expect(engine.kind).toBe('engine');
      expect(engine.message).toBe(
        'Resource file not found: res://does_not_exist.png (expected type: unknown)',
      );
      // The at: line points into core C++; the script location comes from
      // the GDScript backtrace frame.
      expect(engine.script).toBe('res://main.gd');
      expect(engine.line).toBe(9);
      expect(engine.stack).toEqual([
        'at: _load (core/io/resource_loader.cpp:325)',
        '[0] _ready (res://main.gd:9)',
      ]);
    });

    it('parses the SCRIPT ERROR block with a multi-frame stack attached', () => {
      const scriptError = entries[3];
      expect(scriptError.kind).toBe('script_error');
      expect(scriptError.message).toBe(
        "Invalid call. Nonexistent function 'do_something' in base 'Nil'.",
      );
      expect(scriptError.script).toBe('res://main.gd');
      expect(scriptError.line).toBe(15);
      expect(scriptError.stack).toEqual([
        'at: _crash (res://main.gd:15)',
        '[0] _crash (res://main.gd:15)',
        '[1] _ready (res://main.gd:11)',
      ]);
    });
  });

  // ── Real stdout fixture (plain headless run) ─────────────────────────

  describe('stdout-plain fixture (real Godot 4.7.1 stdout)', () => {
    const entries = parseGodotLog(fixtureLines('stdout-plain.txt'));

    it('classifies the engine banner as engine and prints as print', () => {
      expect(entries.map((e) => e.kind)).toEqual([
        'engine',
        'print',
        'print',
        'print',
      ]);
      expect(entries[0].message).toMatch(/^Godot Engine v4\.7\.1/);
      expect(entries[1].message).toBe('Hello from plain print');
      expect(entries[2].message).toBe('Second plain print line');
      expect(entries[3].message).toBe('A print between error blocks');
    });
  });

  // ── Real -d fixtures (what run_project actually captures) ────────────

  describe('stdout-debug fixture (-d run: debugger break block)', () => {
    const entries = parseGodotLog(fixtureLines('stdout-debug.txt'));

    it('groups the debugger break with its *Frame stack line', () => {
      const brk = entries.find((e) => e.message.startsWith('Debugger Break'));
      expect(brk).toBeDefined();
      expect(brk!.kind).toBe('engine');
      expect(brk!.script).toBe('res://main.gd');
      expect(brk!.line).toBe(15);
      expect(brk!.stack).toEqual([
        "*Frame 0 - res://main.gd:15 in function '_crash'",
      ]);
    });

    it('classifies the debugger prompt lines as engine noise, not prints', () => {
      const kinds = new Map(entries.map((e) => [e.message, e.kind]));
      expect(kinds.get('Enter "help" for assistance.')).toBe('engine');
      expect(kinds.get('debug>')).toBe('engine');
    });
  });

  describe('stderr-debug fixture (-d run: adds the GDScript compile warning)', () => {
    const entries = parseGodotLog(fixtureLines('stderr-debug.txt'));

    it('keeps the compile warning as engine (at: GDScript::reload, no backtrace)', () => {
      const compileWarning = entries[0];
      expect(compileWarning.kind).toBe('engine');
      expect(compileWarning.message).toMatch(/^The local variable "missing"/);
      expect(compileWarning.script).toBe('res://main.gd');
      expect(compileWarning.line).toBe(9);
      expect(compileWarning.stack).toEqual([
        'at: GDScript::reload (res://main.gd:9)',
      ]);
    });

    it('still finds push_warning, push_error, engine error, and script_error', () => {
      expect(entries.map((e) => e.kind)).toEqual([
        'engine',
        'push_warning',
        'push_error',
        'engine',
        'script_error',
      ]);
    });
  });

  // ── Interleaved noise (combined stdout+stderr capture, T9b) ──────────

  describe('interleaved noise', () => {
    it('attaches stack lines to their error even when prints interleave', () => {
      // The combined chronological capture can put stdout prints between an
      // error header and its continuation lines.
      const entries = parseGodotLog([
        'SCRIPT ERROR: Invalid call. Boom.',
        'a stdout print sneaking in',
        '          at: _crash (res://main.gd:15)',
        'another stdout print',
        '          GDScript backtrace (most recent call first):',
        '              [0] _crash (res://main.gd:15)',
        '              [1] _ready (res://main.gd:11)',
      ]);

      expect(entries).toHaveLength(3);
      const [err, print1, print2] = entries;
      expect(err.kind).toBe('script_error');
      expect(err.script).toBe('res://main.gd');
      expect(err.line).toBe(15);
      expect(err.stack).toEqual([
        'at: _crash (res://main.gd:15)',
        '[0] _crash (res://main.gd:15)',
        '[1] _ready (res://main.gd:11)',
      ]);
      expect(print1).toEqual({ kind: 'print', message: 'a stdout print sneaking in' });
      expect(print2).toEqual({ kind: 'print', message: 'another stdout print' });
    });

    it('starts a new block when a second header interrupts the first', () => {
      const entries = parseGodotLog([
        'ERROR: first error',
        'ERROR: second error',
        '   at: push_error (core/variant/variant_utility.cpp:1023)',
        '       [0] _ready (res://main.gd:8)',
      ]);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ kind: 'engine', message: 'first error' });
      expect(entries[1].kind).toBe('push_error');
      expect(entries[1].stack).toHaveLength(2);
    });
  });

  // ── Malformed / partial input (never throws) ─────────────────────────

  describe('malformed and partial input', () => {
    it('degrades an orphaned at: line (no preceding header) to print', () => {
      const entries = parseGodotLog(['   at: _crash (res://main.gd:15)']);
      expect(entries).toEqual([
        { kind: 'print', message: '   at: _crash (res://main.gd:15)' },
      ]);
    });

    it('degrades orphaned backtrace frames (cursor sliced mid-block) to prints', () => {
      // A since_line cursor can land between a header and its frames.
      const entries = parseGodotLog([
        '              [1] _ready (res://main.gd:11)',
        'normal print after',
      ]);
      expect(entries.map((e) => e.kind)).toEqual(['print', 'print']);
    });

    it('keeps a header with no continuation lines as a bare entry', () => {
      const entries = parseGodotLog(['SCRIPT ERROR: truncated at end of window']);
      expect(entries).toEqual([
        { kind: 'script_error', message: 'truncated at end of window' },
      ]);
    });

    it('treats an unindented at:-looking line as a print, not a continuation', () => {
      const entries = parseGodotLog([
        'ERROR: real error',
        'at: fake (res://main.gd:1)',
      ]);
      expect(entries[1]).toEqual({
        kind: 'print',
        message: 'at: fake (res://main.gd:1)',
      });
      expect(entries[0].stack).toBeUndefined();
    });

    it('accepts the USER-prefixed header variant', () => {
      const entries = parseGodotLog([
        'USER ERROR: threaded push_error',
        '   at: push_error (core/variant/variant_utility.cpp:1023)',
      ]);
      expect(entries[0].kind).toBe('push_error');
      expect(entries[0].message).toBe('threaded push_error');
    });

    it('skips empty and whitespace-only lines', () => {
      const entries = parseGodotLog(['', '   ', 'real print', '']);
      expect(entries).toEqual([{ kind: 'print', message: 'real print' }]);
    });

    it('never throws on weird input', () => {
      const weird = [
        'ERROR:',
        'ERROR: ',
        'at:',
        '   at: broken (no-line)',
        '  control chars',
        '[999999999999999999999] overflow (res://x.gd:1)',
        'SCRIPT ERROR: \uD800 lone surrogate',
        '          at: _x (res://\uD800.gd:2)',
        null as unknown as string,
        undefined as unknown as string,
        42 as unknown as string,
      ];
      let entries: GodotLogEntry[] = [];
      expect(() => {
        entries = parseGodotLog(weird);
      }).not.toThrow();
      expect(Array.isArray(entries)).toBe(true);
      // Non-string junk is skipped, everything else lands somewhere.
      expect(entries.length).toBeGreaterThan(0);
    });

    it('returns an empty array for empty input', () => {
      expect(parseGodotLog([])).toEqual([]);
    });
  });
});
