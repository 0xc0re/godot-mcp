#!/usr/bin/env node
/**
 * Godot MCP Server - Entry Point
 *
 * Creates the MCP server, registers tool domains, and connects stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServerContext } from './server.js';
import { registerEditorTools } from './tools/editor.js';
import { registerProjectTools } from './tools/project.js';
import { registerResourceTools } from './tools/resource.js';
import { registerSceneTools } from './tools/scene.js';
import { registerScriptTools } from './tools/script.js';
import { registerUidTools } from './tools/uid.js';
import { registerDiagnosticsTools } from './tools/diagnostics.js';
import { registerCompositionTools } from './tools/composition.js';
import { registerConfigTools } from './tools/config.js';
import { registerShaderTools } from './tools/shader.js';
import { registerExportTools } from './tools/export.js';
import { registerAnimationTools } from './tools/animation.js';
import { registerTileMapTools } from './tools/tilemap.js';
import { registerRuntimeTools } from './tools/runtime.js';
import { registerGodotResources } from './resources/godot-resources.js';
import { logger, wrapServerWithLogging } from './logger.js';

const server = new McpServer(
  { name: 'godot-mcp', version: '0.2.0' },
  { capabilities: { tools: {}, resources: {} } },
);

// Error handling on the underlying Server instance
server.server.onerror = (error: unknown) => logger.error(`MCP protocol error: ${error}`);

const ctx = await createServerContext();

// Wrap registerTool to add automatic logging to every tool callback
wrapServerWithLogging(server);

// Register all tool domains (must happen before connect)
registerEditorTools(server, ctx);
registerProjectTools(server, ctx);
registerResourceTools(server, ctx);
registerSceneTools(server, ctx);
registerScriptTools(server, ctx);
registerUidTools(server, ctx);
registerDiagnosticsTools(server, ctx);
// Scene composition tools (signals, instances, groups, batch properties)
registerCompositionTools(server, ctx);
// Project configuration tools (input actions, shaders, export)
registerConfigTools(server, ctx);
registerShaderTools(server, ctx);
registerExportTools(server, ctx);
// Animation & tilemap tools (Phase 7)
registerAnimationTools(server, ctx);
registerTileMapTools(server, ctx);
// Runtime inspection & hot-reload tools (Phase 8)
registerRuntimeTools(server, ctx);

// Register MCP resources for @mention context
registerGodotResources(server, ctx);

// Graceful shutdown: kill all tracked processes, close server
const shutdown = async () => {
  logger.info('Server shutting down...');
  if (ctx.activeProcess) {
    ctx.activeProcess.process.kill();
    ctx.activeProcess = null;
  }
  for (const proc of ctx.trackedProcesses) {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  }
  ctx.trackedProcesses.clear();
  // Clean up LSP client and headless editor process
  if (ctx.lspClient) {
    ctx.lspClient.disconnect();
    ctx.lspClient = undefined;
  }
  if (ctx.lspProcess && !ctx.lspProcess.killed) {
    ctx.lspProcess.kill('SIGTERM');
    ctx.lspProcess = undefined;
  }
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Connect transport and start
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('Server started on stdio transport');
