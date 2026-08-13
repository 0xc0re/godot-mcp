/**
 * Script tool domain: validate_scripts, list_scripts, query_class
 *
 * Batch-validates all GDScript files in a project via Godot headless.
 * Lists project scripts with introspection data (methods, properties, signals).
 * Queries Godot ClassDB for engine class metadata.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerContext } from '../types.js';
import { runOperation } from '../godot.js';
import { toolError } from '../errors.js';
import { withProject, textResult } from './common.js';

/**
 * Find the bare JSON summary line an op printed to stdout.
 *
 * validate_scripts / list_scripts don't emit a success/error envelope — they
 * print a bare summary JSON line as their last output. Scans stdout from the
 * last line backwards (the summary is trailing) and returns the first line
 * that parses as JSON and satisfies the shape guard, so log noise and
 * `{"success":false,...}` failure envelopes are never mistaken for a summary.
 */
function findSummaryJson<T>(
  stdout: string,
  isSummary: (candidate: unknown) => candidate is T,
): T | undefined {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) {
      continue;
    }
    try {
      const candidate: unknown = JSON.parse(line);
      if (isSummary(candidate)) {
        return candidate;
      }
    } catch {
      // Not valid JSON — keep scanning.
    }
  }
  return undefined;
}

interface ValidateScriptsSummary {
  results: Array<{ file: string; valid: boolean; error?: string }>;
  total: number;
  errors: number;
  valid: number;
}

function isValidateScriptsSummary(candidate: unknown): candidate is ValidateScriptsSummary {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  // Check the counters as well as the array key: a partial match (e.g. a
  // stray {"results": []} debug line) would otherwise render
  // "Validated undefined files" (ledgered T4 guard hardening).
  const summary = candidate as Partial<ValidateScriptsSummary>;
  return (
    Array.isArray(summary.results) &&
    typeof summary.total === 'number' &&
    typeof summary.errors === 'number' &&
    typeof summary.valid === 'number'
  );
}

interface ListScriptsSummary {
  scripts: Array<{
    path: string;
    class_name: string;
    methods: Array<{ name: string; args: number }>;
    properties: Array<{ name: string; type: number }>;
    signals: Array<{ name: string; args: number }>;
  }>;
  total: number;
}

function isListScriptsSummary(candidate: unknown): candidate is ListScriptsSummary {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  // Require the count too, so a partial match can't render "Found undefined
  // scripts" (ledgered T4 guard hardening).
  const summary = candidate as Partial<ListScriptsSummary>;
  return Array.isArray(summary.scripts) && typeof summary.total === 'number';
}

/**
 * Bare class-info JSON printed by the query_class op (no success envelope).
 */
interface ClassInfoSummary {
  class_name: string;
  parent_class?: string;
  properties: unknown[];
  methods: unknown[];
  signals: unknown[];
}

function isClassInfoSummary(candidate: unknown): candidate is ClassInfoSummary {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const summary = candidate as Partial<ClassInfoSummary>;
  return (
    typeof summary.class_name === 'string' &&
    Array.isArray(summary.properties) &&
    Array.isArray(summary.methods) &&
    Array.isArray(summary.signals)
  );
}

export function registerScriptTools(server: McpServer, ctx: ServerContext): void {
  // validate_scripts tool (SCRI-01)
  server.registerTool(
    'validate_scripts',
    {
      title: 'Validate Scripts',
      description:
        'Batch-validate all GDScript files in a project for parse errors. Returns a list of files with their validation status.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        path_filter: z
          .string()
          .optional()
          .describe(
            'Optional subdirectory to limit validation (e.g. "scripts/" to only check scripts/ folder). Defaults to entire project.',
          ),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to validate scripts',
      },
      async ({ project_path, path_filter }) => {
        const params: Record<string, unknown> = {
          path_filter: path_filter || '',
        };

        const result = await runOperation(ctx, project_path, 'validate_scripts', params);

        // validate_scripts doesn't emit a success/error envelope, so parse the JSON
        // summary line out of stdout directly rather than relying on result.data.
        // NOTE: a broken script in the project makes the Godot engine itself write
        // `ERROR: Failed to load script ...` to stderr even though the op completes
        // and prints its per-file summary (exit 0), which flips result.ok to false.
        // Reporting invalid scripts is this tool's primary purpose, so a recovered
        // summary always wins over the ok:false verdict; only fail hard when no
        // summary was produced.
        const parsed = findSummaryJson(result.stdout, isValidateScriptsSummary);

        if (!parsed) {
          if (!result.ok) {
            return toolError(`Failed to validate scripts: ${result.error}`, [
              'Godot may have encountered an error during validation',
              result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
            ]);
          }
          return toolError('Failed to parse validation results from Godot output', [
            'Godot may have encountered an error during validation',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        // Format the output
        let text = `Validated ${parsed.total} files: ${parsed.valid} valid, ${parsed.errors} error${parsed.errors !== 1 ? 's' : ''}`;

        if (parsed.errors > 0) {
          text += '\n\nErrors:';
          for (const entry of parsed.results) {
            if (!entry.valid) {
              text += `\n- ${entry.file}: ${entry.error || 'Unknown error'}`;
            }
          }
        }

        return textResult(text);
      },
    ),
  );

  // list_scripts tool (SCRI-02)
  server.registerTool(
    'list_scripts',
    {
      title: 'List Scripts',
      description:
        'List all GDScript files in a project with introspection data: class name, methods, properties, and signals for each script.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        path_filter: z
          .string()
          .optional()
          .describe(
            'Subdirectory to limit search, e.g. "scripts/" (default: entire project)',
          ),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to list scripts',
      },
      async ({ project_path, path_filter }) => {
        const params: Record<string, unknown> = {
          path_filter: (path_filter as string) || '',
        };

        const result = await runOperation(ctx, project_path, 'list_scripts', params);

        // list_scripts doesn't emit a success/error envelope, so parse the JSON
        // summary line out of stdout directly rather than relying on result.data.
        // NOTE: a broken script in the project makes the Godot engine itself write
        // `ERROR: Failed to load script ...` to stderr even though the op completes
        // and prints its summary (exit 0), which flips result.ok to false. A
        // recovered summary always wins over the ok:false verdict; only fail hard
        // when no summary was produced.
        const parsed = findSummaryJson(result.stdout, isListScriptsSummary);

        if (!parsed) {
          if (!result.ok) {
            return toolError(`Failed to list scripts: ${result.error}`, [
              'Godot may have encountered an error during script listing',
              result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
            ]);
          }
          return toolError('Failed to parse script list from Godot output', [
            'Godot may have encountered an error during script listing',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        // Format the output
        let text = `Found ${parsed.total} script${parsed.total !== 1 ? 's' : ''}`;

        for (const script of parsed.scripts) {
          text += `\n\n${script.path}`;
          if (script.class_name) {
            text += ` (class: ${script.class_name})`;
          }
          text += `\n  ${script.methods.length} method${script.methods.length !== 1 ? 's' : ''}`;
          text += `, ${script.properties.length} propert${script.properties.length !== 1 ? 'ies' : 'y'}`;
          text += `, ${script.signals.length} signal${script.signals.length !== 1 ? 's' : ''}`;
        }

        return textResult(text);
      },
    ),
  );

  // query_class tool (SCRI-04)
  server.registerTool(
    'query_class',
    {
      title: 'Query Class',
      description:
        'Query Godot ClassDB for a class\'s properties, methods, and signals. Use this to verify API correctness before generating code.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        class_name: z
          .string()
          .describe('Godot class name to query (e.g. Node2D, CharacterBody3D)'),
        no_inheritance: z
          .boolean()
          .optional()
          .describe(
            'If true, only return class-own members, not inherited (default: false)',
          ),
      },
    },
    withProject(
      {
        catchPrefix: 'Failed to query class',
      },
      async ({ project_path, class_name, no_inheritance }) => {
        const params: Record<string, unknown> = {
          class_name: class_name as string,
          no_inheritance: (no_inheritance as boolean) || false,
        };

        const result = await runOperation(ctx, project_path, 'query_class', params);

        // query_class's success path doesn't emit a success envelope — it prints
        // bare class-info JSON to stdout. NOTE: a broken script in the project
        // makes the Godot engine itself write `ERROR: ...` lines to stderr even
        // though the query completes and prints valid class JSON (exit 0), which
        // trips the tier-3 stderr-marker verdict and flips result.ok to false.
        // Apply the same recover-before-error pattern as validate_scripts /
        // list_scripts: a recovered class JSON always wins over the ok:false
        // verdict; only fail hard when no class JSON was produced (T4 deferred).
        const parsed = findSummaryJson(result.stdout, isClassInfoSummary);

        if (!parsed) {
          if (!result.ok) {
            return toolError(`Failed to query class: ${result.error}`, [
              'Check that the class name is spelled correctly',
              'Use a built-in Godot class name like Node2D, CharacterBody3D, etc.',
            ]);
          }
          return toolError('Failed to parse class info from Godot output', [
            'Godot may have encountered an error during class query',
            result.stderr ? `Stderr: ${result.stderr}` : 'No stderr output',
          ]);
        }

        return textResult(JSON.stringify(parsed, null, 2));
      },
    ),
  );
}
