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
import { registerSceneTools } from './tools/scene.js';
import { registerUidTools } from './tools/uid.js';

const server = new McpServer(
  { name: 'godot-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } },
);

// Error handling on the underlying Server instance
server.server.onerror = (error: unknown) => console.error('[MCP Error]', error);

const ctx = await createServerContext();

// Register all tool domains (must happen before connect)
registerEditorTools(server, ctx);
registerProjectTools(server, ctx);
registerSceneTools(server, ctx);
registerUidTools(server, ctx);

// Cleanup on exit
const cleanup = async () => {
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
  await server.close();
  process.exit(0);
};

process.on('SIGINT', cleanup);

// Connect transport and start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Godot MCP server running on stdio');
