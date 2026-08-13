/**
 * Testing tool domain: run_tests.
 *
 * run_tests uses execGodot directly (NOT runOperation) since
 * GUT test execution is a CLI operation (--headless -s gut_cmdln.gd),
 * not a godot_operations.gd dispatch. Extended 120s timeout for test suites.
 * There are no runOperation/executeOperation call sites in this module.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ServerContext } from '../types.js';
import { execGodot, validatePath } from '../godot.js';
import { toolError } from '../errors.js';

export function registerTestingTools(server: McpServer, ctx: ServerContext): void {
  // Tool: run_tests
  server.registerTool(
    'run_tests',
    {
      title: 'Run Tests',
      description:
        'Run GUT (Godot Unit Test) tests headlessly via gut_cmdln.gd. Supports filtering by directory, file, and test name. Parses stdout for pass/fail/error counts.',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        test_dir: z
          .string()
          .optional()
          .default('res://tests/')
          .describe('Test directory (GUT -gdir flag)'),
        test_file: z
          .string()
          .optional()
          .describe('Specific test file to run (GUT -gtest flag)'),
        test_name: z
          .string()
          .optional()
          .describe('Specific test function to run (GUT -gunit_test_name flag)'),
      },
    },
    async ({ project_path, test_dir, test_file, test_name }) => {
      if (!validatePath(project_path as string)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path as string, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        // Pre-flight validation: GUT must be installed
        const gutScript = join(
          project_path as string,
          'addons',
          'gut',
          'gut_cmdln.gd',
        );
        if (!existsSync(gutScript)) {
          return toolError('GUT testing framework not found', [
            'Install GUT via the Godot Asset Library: AssetLib > Search "GUT" > Install',
            'Or install manually: https://github.com/bitwes/Gut',
            'Ensure addons/gut/gut_cmdln.gd exists in your project',
          ]);
        }

        // Build CLI args for GUT test execution
        const args = [
          '--headless',
          '--path',
          project_path as string,
          '-s',
          'addons/gut/gut_cmdln.gd',
          '-gexit',
        ];

        if (test_dir) {
          args.push(`-gdir=${test_dir as string}`);
        }
        if (test_file) {
          args.push(`-gtest=${test_file as string}`);
        }
        if (test_name) {
          args.push(`-gunit_test_name=${test_name as string}`);
        }

        const { stdout } = await execGodot(ctx.godotPath, args, {
          timeout: 120_000,
        });

        // Parse GUT output for pass/fail/error counts
        const passedMatch = stdout.match(/[Pp]assed:\s*(\d+)/);
        const failedMatch = stdout.match(/[Ff]ailed:\s*(\d+)/);
        const errorsMatch = stdout.match(/[Ee]rrors:\s*(\d+)/);

        const passed = passedMatch ? parseInt(passedMatch[1], 10) : null;
        const failed = failedMatch ? parseInt(failedMatch[1], 10) : null;
        const errors = errorsMatch ? parseInt(errorsMatch[1], 10) : null;

        // If we couldn't parse any counts, return raw output
        if (passed === null && failed === null && errors === null) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  warning: 'Could not parse test results from GUT output',
                  output: stdout,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                passed: passed ?? 0,
                failed: failed ?? 0,
                errors: errors ?? 0,
                output: stdout,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to run tests: ${errorMessage}`, [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify that GUT is properly installed in the project',
          'For large test suites, the 120-second timeout may not be sufficient',
        ]);
      }
    },
  );
}
