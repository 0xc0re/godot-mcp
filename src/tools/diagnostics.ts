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
import { join } from 'path';
import { spawn } from 'child_process';
import { Socket } from 'net';
import type { ServerContext } from '../types.js';
import { resolveWithinProject, validatePath, trackProcess } from '../godot.js';
import { toolError } from '../errors.js';
import { LspClient } from '../lsp/client.js';
import { parseScene } from '../parsers/tscn-parser.js';
import { parseProjectSettings } from '../parsers/project-parser.js';

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

  // validate_scene — static analysis of .tscn files for common issues
  server.registerTool(
    'validate_scene',
    {
      title: 'Validate Scene',
      description:
        'Analyze a .tscn scene file for common issues that cause silent bugs in Godot games. ' +
        'Checks for physics bodies without collision shapes, Area nodes without shapes, ' +
        'duplicate sibling node names, and root scripts that reference autoloads (MCP corruption risk).',
      inputSchema: {
        project_path: z.string().describe('Path to the Godot project directory'),
        scene_path: z
          .string()
          .describe(
            'Path to the scene file relative to project root (e.g., "scenes/player.tscn")',
          ),
      },
    },
    async ({ project_path, scene_path }) => {
      if (!validatePath(project_path) || !validatePath(scene_path)) {
        return toolError('Invalid path', [
          'Provide valid paths without ".." or other potentially unsafe characters',
        ]);
      }

      try {
        const projectFile = join(project_path, 'project.godot');
        if (!existsSync(projectFile)) {
          return toolError(`Not a valid Godot project: ${project_path}`, [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]);
        }

        const sceneFilePath = resolveWithinProject(project_path, scene_path);
        if (sceneFilePath === null) {
          return toolError('Invalid scene_path: path resolves outside the project directory', [
            'Use a path relative to the project root',
            'Do not use "..", absolute paths, or symlinks that escape the project',
          ]);
        }
        if (!existsSync(sceneFilePath)) {
          return toolError(`Scene file does not exist: ${scene_path}`, [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]);
        }

        const content = readFileSync(sceneFilePath, 'utf-8');
        const parsed = parseScene(content);

        interface Issue {
          check: string;
          severity: 'error' | 'warning' | 'info';
          nodes: string[];
          detail: string;
        }

        const issues: Issue[] = [];

        // Build a helper to compute the full path of a node.
        // Root node (no parent) => its name. Direct children (parent=".") => "RootName/ChildName".
        // Deeper children (parent="A/B") => "RootName/A/B/ChildName".
        const rootNode = parsed.nodes.length > 0 ? parsed.nodes[0] : null;
        const rootName = rootNode?.name ?? '';

        function fullPath(node: typeof parsed.nodes[0]): string {
          if (!node.parent) return node.name; // root node
          if (node.parent === '.') return `${rootName}/${node.name}`;
          return `${rootName}/${node.parent}/${node.name}`;
        }

        // Build a map of parent path -> child nodes for sibling and child lookups
        const childrenByParentPath = new Map<string, typeof parsed.nodes>();
        for (const node of parsed.nodes) {
          if (!node.parent) continue; // root node has no parent
          // Compute the full path of the parent
          let parentFullPath: string;
          if (node.parent === '.') {
            parentFullPath = rootName;
          } else {
            parentFullPath = `${rootName}/${node.parent}`;
          }
          if (!childrenByParentPath.has(parentFullPath)) {
            childrenByParentPath.set(parentFullPath, []);
          }
          childrenByParentPath.get(parentFullPath)!.push(node);
        }

        // (a) Physics bodies without collision shapes
        const bodyTypes = [
          'CharacterBody2D', 'CharacterBody3D',
          'RigidBody2D', 'RigidBody3D',
          'StaticBody2D', 'StaticBody3D',
          'AnimatableBody2D', 'AnimatableBody3D',
        ];
        const collisionTypes = [
          'CollisionShape2D', 'CollisionShape3D',
          'CollisionPolygon2D', 'CollisionPolygon3D',
        ];

        const bodiesWithoutCollision: string[] = [];
        for (const node of parsed.nodes) {
          if (!node.type || !bodyTypes.some((bt) => node.type!.includes('Body') && node.type === bt)) continue;
          const nodePath = fullPath(node);
          const children = childrenByParentPath.get(nodePath) ?? [];
          const hasCollision = children.some(
            (child) => child.type !== undefined && collisionTypes.includes(child.type),
          );
          if (!hasCollision) {
            bodiesWithoutCollision.push(nodePath);
          }
        }
        if (bodiesWithoutCollision.length > 0) {
          issues.push({
            check: 'physics_body_without_collision_shape',
            severity: 'error',
            nodes: bodiesWithoutCollision,
            detail:
              'Physics body nodes require at least one CollisionShape or CollisionPolygon child to function. ' +
              'Without a shape, the body will not interact with other physics objects.',
          });
        }

        // (c) Area nodes without collision shapes
        const areaTypes = ['Area2D', 'Area3D'];
        const areasWithoutCollision: string[] = [];
        for (const node of parsed.nodes) {
          if (!node.type || !areaTypes.includes(node.type)) continue;
          const nodePath = fullPath(node);
          const children = childrenByParentPath.get(nodePath) ?? [];
          const hasCollision = children.some(
            (child) => child.type !== undefined && collisionTypes.includes(child.type),
          );
          if (!hasCollision) {
            areasWithoutCollision.push(nodePath);
          }
        }
        if (areasWithoutCollision.length > 0) {
          issues.push({
            check: 'area_without_collision_shape',
            severity: 'warning',
            nodes: areasWithoutCollision,
            detail:
              'Area nodes without a CollisionShape or CollisionPolygon child cannot detect overlaps or collisions. ' +
              'This is sometimes intentional but usually indicates a missing shape.',
          });
        }

        // (d) Duplicate sibling node names
        const duplicateNodes: string[] = [];
        for (const [parentPath, children] of childrenByParentPath.entries()) {
          const nameCount = new Map<string, number>();
          for (const child of children) {
            nameCount.set(child.name, (nameCount.get(child.name) ?? 0) + 1);
          }
          for (const [name, count] of nameCount.entries()) {
            if (count > 1) {
              duplicateNodes.push(`${parentPath}/${name} (x${count})`);
            }
          }
        }
        if (duplicateNodes.length > 0) {
          issues.push({
            check: 'duplicate_sibling_names',
            severity: 'warning',
            nodes: duplicateNodes,
            detail:
              'Multiple sibling nodes share the same name. Godot will auto-rename them at runtime, ' +
              'which can cause get_node() calls to return unexpected nodes.',
          });
        }

        // (b) Root script references autoloads (MCP corruption risk)
        if (rootNode) {
          // Find if root node has a script ext_resource reference
          const scriptProp = rootNode.properties['script'];
          if (scriptProp) {
            // scriptProp looks like: ExtResource("1_abc") or ExtResource("2")
            const extResMatch = scriptProp.match(/ExtResource\("([^"]+)"\)/);
            if (extResMatch) {
              const extResId = extResMatch[1];
              const scriptResource = parsed.extResources.find(
                (r) => r.id === extResId && r.type === 'Script',
              );
              if (scriptResource) {
                // Convert res:// path to filesystem path
                const scriptResPath = scriptResource.path.replace(/^res:\/\//, '');
                const scriptFilePath = join(project_path, scriptResPath);
                if (existsSync(scriptFilePath)) {
                  const scriptContent = readFileSync(scriptFilePath, 'utf-8');

                  // Parse project.godot to get autoload names
                  const projectContent = readFileSync(projectFile, 'utf-8');
                  const projectSettings = parseProjectSettings(projectContent);
                  const autoloadSection = projectSettings.sections['autoload'] ?? {};
                  const autoloadNames = Object.keys(autoloadSection);

                  const referencedAutoloads: string[] = [];
                  for (const autoloadName of autoloadNames) {
                    // Check if the autoload name appears in the script as a standalone identifier
                    // (word boundary match to avoid false positives)
                    const regex = new RegExp(`\\b${autoloadName}\\b`);
                    if (regex.test(scriptContent)) {
                      referencedAutoloads.push(autoloadName);
                    }
                  }

                  if (referencedAutoloads.length > 0) {
                    issues.push({
                      check: 'root_script_references_autoloads',
                      severity: 'warning',
                      nodes: [rootName],
                      detail:
                        `Root script "${scriptResPath}" references autoloads: ${referencedAutoloads.join(', ')}. ` +
                        'MCP add_node/modify_node may corrupt this scene when Godot re-saves it. ' +
                        'Use manual .tscn editing instead.',
                    });
                  }
                }
              }
            }
          }
        }

        const summary = {
          errors: issues.filter((i) => i.severity === 'error').length,
          warnings: issues.filter((i) => i.severity === 'warning').length,
          info: issues.filter((i) => i.severity === 'info').length,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  scene_path,
                  issues,
                  summary,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to validate scene: ${errorMessage}`, [
          'Ensure the scene file is a valid .tscn file',
          'Check if the file is not corrupted',
          'Verify the scene and project paths are correct',
        ]);
      }
    },
  );
}
