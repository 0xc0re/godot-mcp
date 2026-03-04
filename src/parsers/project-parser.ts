/**
 * INI-format parser for Godot project.godot files.
 *
 * Parses the line-based format into structured TypeScript objects.
 * All property values are stored as raw strings — no type conversion
 * is performed (same convention as tscn-parser.ts).
 *
 * Read operations use this parser (fast, ~1ms). Write operations use
 * Godot's ConfigFile API via headless GDScript (correct types).
 */

import type { ParsedProjectSettings } from './project-types.js';

/**
 * Check if a string value has balanced brackets/parentheses/braces,
 * indicating it is a complete (not multi-line) value.
 *
 * Note: duplicated from tscn-parser.ts to avoid changing that module's
 * exports. Both implementations are identical (~40 lines).
 */
function isBalanced(value: string): boolean {
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

/**
 * Parse project.godot file content into structured settings.
 *
 * The parser iterates line by line, tracking the current section.
 * Section headers match [word] where word can contain letters, digits,
 * underscores, dots, and slashes (e.g. [editor_plugins]).
 * Key=value splits on the first `=` (no spaces around `=`, unlike .tscn).
 * Multi-line values are accumulated using bracket balancing.
 * Comments (`;` prefix) and empty lines are skipped.
 * config_version is extracted from root level before any section.
 */
export function parseProjectSettings(content: string): ParsedProjectSettings {
  const result: ParsedProjectSettings = {
    sections: {},
    configVersion: 0,
  };

  if (!content.trim()) return result;

  const lines = content.split('\n');

  let currentSection: string | null = null;
  let multiLineKey: string | null = null;
  let multiLineValue = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Skip empty lines
    if (trimmed === '') continue;

    // Skip comment lines
    if (trimmed.startsWith(';')) continue;

    // Handle multi-line value accumulation
    if (multiLineKey !== null) {
      multiLineValue += '\n' + trimmed;
      if (isBalanced(multiLineValue)) {
        if (currentSection !== null) {
          result.sections[currentSection][multiLineKey] = multiLineValue;
        }
        multiLineKey = null;
        multiLineValue = '';
      }
      continue;
    }

    // Try parsing as section header: [section_name]
    const sectionMatch = trimmed.match(/^\[([\w./-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result.sections[currentSection]) {
        result.sections[currentSection] = {};
      }
      continue;
    }

    // Try parsing as key=value (split on first =, no spaces around =)
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx);
    const value = trimmed.substring(eqIdx + 1);

    // Root-level config_version
    if (currentSection === null && key === 'config_version') {
      result.configVersion = parseInt(value, 10);
      continue;
    }

    // Skip root-level keys that aren't config_version (shouldn't happen in valid files)
    if (currentSection === null) continue;

    // Check if the value is balanced (complete)
    if (isBalanced(value)) {
      result.sections[currentSection][key] = value;
    } else {
      // Start multi-line value accumulation
      multiLineKey = key;
      multiLineValue = value;
    }
  }

  return result;
}
