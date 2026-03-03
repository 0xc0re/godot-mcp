import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

describe('McpServer instantiation', () => {
  it('can be imported and instantiated without throwing', () => {
    expect(() => {
      new McpServer(
        { name: 'test', version: '0.0.1' },
        { capabilities: { tools: {} } }
      );
    }).not.toThrow();
  });

  it('can register a tool with Zod schema without throwing', () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } }
    );

    expect(() => {
      server.registerTool(
        'test_tool',
        {
          title: 'Test Tool',
          description: 'A test tool',
          inputSchema: {
            name: z.string().describe('A name'),
          },
        },
        async ({ name }) => {
          return {
            content: [{ type: 'text' as const, text: name }],
          };
        }
      );
    }).not.toThrow();
  });
});
