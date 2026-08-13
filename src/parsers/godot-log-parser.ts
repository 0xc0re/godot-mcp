/**
 * Parser for captured Godot runtime output (stdout/stderr of a game
 * process spawned by run_project / restart_project).
 *
 * Groups the multi-line error blocks Godot 4.x prints into structured
 * entries. Formats are taken from REAL Godot 4.7.1 output (see
 * tests/fixtures/godot-log/, captured live):
 *
 *   SCRIPT ERROR: Invalid call. Nonexistent function 'do_something' in base 'Nil'.
 *             at: _crash (res://main.gd:15)
 *             GDScript backtrace (most recent call first):
 *                 [0] _crash (res://main.gd:15)
 *                 [1] _ready (res://main.gd:11)
 *
 *   ERROR: Something failed: this is a push_error
 *      at: push_error (core/variant/variant_utility.cpp:1023)
 *      GDScript backtrace (most recent call first):
 *          [0] _ready (res://main.gd:8)
 *
 *   WARNING: Watch out: this is a push_warning
 *        at: push_warning (core/variant/variant_utility.cpp:1033)
 *        ...
 *
 * push_error / push_warning are distinguished from plain engine
 * ERROR/WARNING blocks by the function name in the `at:` line.
 *
 * When the game runs with -d (run_project always passes it), a script
 * error additionally drops the process into the local stdout debugger:
 *
 *   Debugger Break, Reason: 'Invalid call. ...'
 *   *Frame 0 - res://main.gd:15 in function '_crash'
 *   Enter "help" for assistance.
 *   debug>
 *
 * Those stdout lines are classified as `engine` entries (the underlying
 * script error is already reported on stderr) with the *Frame lines
 * attached as the break entry's stack.
 *
 * Robustness contract: the parser NEVER throws. Continuation lines
 * (`at:`, `GDScript backtrace`, `[N] ...` frames) attach to the most
 * recent error entry even when unrelated lines are interleaved between
 * them (the capture path interleaves stdout and stderr chronologically).
 * Orphaned continuation lines and anything unrecognized degrade to
 * `{kind: 'print'}` entries.
 */

export type GodotLogEntryKind =
  | 'script_error'
  | 'push_error'
  | 'push_warning'
  | 'print'
  | 'engine';

export interface GodotLogEntry {
  kind: GodotLogEntryKind;
  message: string;
  /** res:// path of the originating script, when one can be determined. */
  script?: string;
  /** 1-based line number in `script`, when one can be determined. */
  line?: number;
  /** Attached continuation lines (trimmed): `at:` location and backtrace frames. */
  stack?: string[];
}

/** Error/warning block headers. `USER ` prefix appears in some engine paths. */
const HEADER_RE = /^(?:USER )?(SCRIPT ERROR|ERROR|WARNING): (.*)$/;

/** `at: <function> (<file>:<line>)` continuation line (trimmed form). */
const AT_RE = /^at: (\S+) \((.+):(\d+)\)$/;

/** `[N] <function> (<file>:<line>)` GDScript backtrace frame (trimmed form). */
const FRAME_RE = /^\[(\d+)\] \S+ \((.+):(\d+)\)$/;

/** Banner line introducing backtrace frames — consumed, not kept in stack. */
const BACKTRACE_BANNER_RE = /^GDScript backtrace \(most recent call first\):$/;

/** stdout debugger-break header printed under -d when a script error trips. */
const DEBUGGER_BREAK_RE = /^Debugger Break, Reason: (.*)$/;

/** `*Frame N - res://file.gd:LINE in function 'name'` debugger stack line. */
const DEBUGGER_FRAME_RE = /^\*Frame \d+ - (.+?):(\d+) in function '.*'$/;

/** Known engine-noise stdout lines that are not game prints. */
const ENGINE_NOISE_RE = /^(Godot Engine v|Enter "help" for assistance\.|debug> *$)/;

/**
 * Parse captured Godot output lines into structured entries.
 *
 * `lines` is a flat array of raw captured lines (stdout and stderr may be
 * interleaved in chronological order). Never throws; unparseable input
 * degrades to `print` entries.
 */
export function parseGodotLog(lines: string[]): GodotLogEntry[] {
  const entries: GodotLogEntry[] = [];

  // The most recent entry that continuation lines may attach to. Survives
  // interleaved unrelated lines; replaced when a new block header starts.
  let attachable: GodotLogEntry | null = null;
  // Whether `attachable` came from a Debugger Break (attaches *Frame lines)
  // rather than a stderr error block (attaches at:/backtrace lines).
  let attachableIsDebugBreak = false;

  for (const rawLine of lines) {
    try {
      if (typeof rawLine !== 'string') continue;
      const trimmed = rawLine.trim();
      if (trimmed === '') continue;

      // ── Block headers ──────────────────────────────────────────────
      const header = HEADER_RE.exec(trimmed);
      if (header) {
        const entry: GodotLogEntry = {
          // ERROR/WARNING default to `engine`; the `at:` continuation line
          // upgrades them to push_error/push_warning when the failing
          // function is the push_* utility itself.
          kind: header[1] === 'SCRIPT ERROR' ? 'script_error' : 'engine',
          message: header[2],
        };
        entries.push(entry);
        attachable = entry;
        attachableIsDebugBreak = false;
        continue;
      }

      const debugBreak = DEBUGGER_BREAK_RE.exec(trimmed);
      if (debugBreak) {
        const entry: GodotLogEntry = {
          kind: 'engine',
          message: trimmed,
        };
        entries.push(entry);
        attachable = entry;
        attachableIsDebugBreak = true;
        continue;
      }

      // ── Continuation lines ─────────────────────────────────────────
      if (attachable && !attachableIsDebugBreak) {
        const startsIndented = rawLine !== trimmed;

        const at = AT_RE.exec(trimmed);
        if (at && startsIndented) {
          const [, fn, file, lineNo] = at;
          if (attachable.kind === 'engine') {
            if (fn === 'push_error') attachable.kind = 'push_error';
            else if (fn === 'push_warning') attachable.kind = 'push_warning';
          }
          if (file.startsWith('res://') && attachable.script === undefined) {
            attachable.script = file;
            attachable.line = Number(lineNo);
          }
          (attachable.stack ??= []).push(trimmed);
          continue;
        }

        if (BACKTRACE_BANNER_RE.test(trimmed) && startsIndented) {
          // Banner carries no information beyond "frames follow" — consume it.
          continue;
        }

        const frame = FRAME_RE.exec(trimmed);
        if (frame && startsIndented) {
          const [, , file, lineNo] = frame;
          if (file.startsWith('res://') && attachable.script === undefined) {
            attachable.script = file;
            attachable.line = Number(lineNo);
          }
          (attachable.stack ??= []).push(trimmed);
          continue;
        }
      }

      if (attachable && attachableIsDebugBreak) {
        const dbgFrame = DEBUGGER_FRAME_RE.exec(trimmed);
        if (dbgFrame) {
          const [, file, lineNo] = dbgFrame;
          if (file.startsWith('res://') && attachable.script === undefined) {
            attachable.script = file;
            attachable.line = Number(lineNo);
          }
          (attachable.stack ??= []).push(trimmed);
          continue;
        }
      }

      // ── Everything else ────────────────────────────────────────────
      if (ENGINE_NOISE_RE.test(trimmed)) {
        entries.push({ kind: 'engine', message: trimmed });
        continue;
      }

      // Plain game output (or an orphaned/malformed fragment).
      entries.push({ kind: 'print', message: rawLine });
    } catch {
      // Never throw on weird input — degrade the offending line to a print.
      entries.push({ kind: 'print', message: String(rawLine) });
    }
  }

  return entries;
}
