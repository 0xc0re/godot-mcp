/**
 * Diagnostics tool domain: get_diagnostics
 *
 * Connects to Godot's built-in LSP server over TCP to retrieve
 * GDScript diagnostics (syntax errors, type warnings, undefined variables).
 * Auto-spawns a headless Godot editor if no LSP server is running.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { Socket } from 'net';
import type { ServerContext } from '../types.js';
import { validatePath, trackProcess } from '../godot.js';
import { toolError } from '../errors.js';
import { LspClient } from '../lsp/client.js';

/** Default LSP port for MCP-spawned headless editor (avoids conflict with user's editor on 6005) */
const DEFAULT_LSP_PORT = 6014;

/** Maximum time to wait for headless editor LSP port to become available (ms) */
const PORT_WAIT_TIMEOUT_MS = 10_000;

/** Polling interval for port availability check (ms) */
const PORT_POLL_INTERVAL_MS = 500;

/**
 * Check if a TCP port is accepting connections.
 */
function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tryConnect() {
      const probe = new Socket();
      let settled = false;

      const cleanup = () => {
        if (!settled) {
          settled = true;
          probe.destroy();
        }
      };

      probe.once('connect', () => {
        cleanup();
        resolve();
      });

      probe.once('error', () => {
        cleanup();
        if (Date.now() >= deadline) {
          reject(new Error(`LSP server did not start within ${timeoutMs / 1000}s on port ${port}`));
        } else {
          setTimeout(tryConnect, PORT_POLL_INTERVAL_MS);
        }
      });

      probe.connect(port, host);
    }

    tryConnect();
  });
}

export function registerDiagnosticsTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_diagnostics',
    {
      title: 'Get Diagnostics',
      description:
        'Get GDScript diagnostics (syntax errors, type warnings, undefined variables) for a file ' +
        'using Godot\'s built-in Language Server Protocol. If no LSP server is running, a headless ' +
        'Godot editor is spawned automatically.',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the GDScript (.gd) file to analyze'),
        project_path: z.string().describe('Path to the Godot project directory containing project.godot'),
        port: z
          .number()
          .optional()
          .describe(
            'LSP server port (default: 6014). Uses non-default port to avoid conflict with user\'s editor on 6005.',
          ),
      },
    },
    async ({ file_path, project_path, port }) => {
      const filePath = file_path as string;
      const projectPath = project_path as string;
      const lspPort = (port as number | undefined) ?? DEFAULT_LSP_PORT;

      // Validate paths
      if (!validatePath(filePath) || !validatePath(projectPath)) {
        return toolError('Invalid file or project path', [
          'Provide valid absolute paths without ".." or other potentially unsafe characters',
        ]);
      }

      // Verify file exists and is .gd
      if (!existsSync(filePath)) {
        return toolError(`File not found: ${filePath}`, [
          'Verify the file path is correct',
          'Use an absolute path to the GDScript file',
        ]);
      }

      if (!filePath.endsWith('.gd')) {
        return toolError('File must be a GDScript (.gd) file', [
          'Provide a path to a .gd file',
          'Use validate_scripts for bulk validation of non-.gd files',
        ]);
      }

      try {
        // Read file content
        const fileContent = readFileSync(filePath, 'utf-8');

        // Ensure LSP connection
        if (!ctx.lspClient || !ctx.lspClient.isConnected) {
          // Try connecting to existing LSP server
          const client = new LspClient();
          try {
            await client.connect(lspPort);
            ctx.lspClient = client;
          } catch (err: unknown) {
            // If ECONNREFUSED, spawn headless editor
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes('ECONNREFUSED') || errMsg.includes('connect')) {
              console.error(`[SERVER] No LSP server on port ${lspPort}, spawning headless editor...`);

              const lspProcess = spawn(
                ctx.godotPath,
                ['--editor', '--headless', '--lsp-port', String(lspPort), '--path', projectPath],
                { stdio: 'pipe' },
              );
              ctx.lspProcess = trackProcess(ctx, lspProcess);

              // Wait for LSP port to become available
              await waitForPort(lspPort, 'localhost', PORT_WAIT_TIMEOUT_MS);

              // Connect to the newly spawned LSP server
              const newClient = new LspClient();
              await newClient.connect(lspPort);
              ctx.lspClient = newClient;
            } else {
              throw err;
            }
          }
        }

        // Get diagnostics
        const diagnostics = await ctx.lspClient.getDiagnostics(filePath, fileContent);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                file: filePath,
                diagnostics,
                count: diagnostics.length,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to get diagnostics: ${errorMessage}`, [
          'Check if Godot is installed and accessible',
          'Verify the project path contains a valid project.godot file',
          'Try specifying a different port if the default is in use',
        ]);
      }
    },
  );
}
