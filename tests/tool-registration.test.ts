import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('McpServer instantiation', () => {
  it('can be imported and instantiated without throwing', () => {
    expect(() => {
      new McpServer(
        { name: 'test', version: '0.0.1' },
        { capabilities: { tools: {} } }
      );
    }).not.toThrow();
  });
});
