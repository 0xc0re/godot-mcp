/**
 * Shared text-scanning helpers for the .tscn and project.godot parsers.
 */

/**
 * Check if a string value has balanced brackets/parentheses/braces,
 * indicating it is a complete (not multi-line) value.
 *
 * String literals are skipped (backslash escapes honored) so brackets
 * inside quoted strings don't affect the depth counts.
 *
 * Shared by tscn-parser.ts and project-parser.ts (formerly duplicated
 * in both modules).
 */
export function isBalanced(value: string): boolean {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escapeNext = false;

  for (const ch of value) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    switch (ch) {
      case '(':
        parenDepth++;
        break;
      case ')':
        parenDepth--;
        break;
      case '{':
        braceDepth++;
        break;
      case '}':
        braceDepth--;
        break;
      case '[':
        bracketDepth++;
        break;
      case ']':
        bracketDepth--;
        break;
    }
  }

  return parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
}
