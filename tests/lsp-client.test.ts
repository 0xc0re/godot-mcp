/**
 * Tests for LSP TCP client: connection lifecycle, diagnostics retrieval.
 *
 * Uses vi.mock() to isolate from real TCP sockets and LSP protocol module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Create a fresh mock socket for each test
let mockSocket: EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroyed: boolean;
};

function createMockSocket() {
  const s = new EventEmitter() as typeof mockSocket;
  s.connect = vi.fn();
  s.write = vi.fn();
  s.destroy = vi.fn();
  s.end = vi.fn();
  s.destroyed = false;
  return s;
}

vi.mock('net', () => {
  // Return a class constructor so `new Socket()` works
  return {
    Socket: class MockSocket {
      constructor() {
        return mockSocket;
      }
    },
  };
});

// --- Mock protocol module ---
vi.mock('../src/lsp/protocol.js', () => ({
  encodeMessage: vi.fn((msg: unknown) => {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    return Buffer.from(header + body);
  }),
  parseMessages: vi.fn((buffer: Buffer) => {
    // Default: return empty; tests override as needed
    return { messages: [], remainder: buffer };
  }),
}));

import { encodeMessage, parseMessages } from '../src/lsp/protocol.js';
import { LspClient } from '../src/lsp/client.js';

describe('LspClient', () => {
  let client: LspClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSocket = createMockSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Helper: connect the client through the full initialize handshake */
  async function connectClient(lspClient: LspClient): Promise<void> {
    vi.mocked(parseMessages).mockImplementation((buffer: Buffer) => {
      const str = buffer.toString();
      if (str.includes('"result"')) {
        return {
          messages: [{
            jsonrpc: '2.0' as const,
            id: 1,
            result: { capabilities: {} },
          }],
          remainder: Buffer.alloc(0),
        };
      }
      return { messages: [], remainder: buffer };
    });

    const connectPromise = lspClient.connect(6014);
    mockSocket.emit('connect');
    await vi.advanceTimersByTimeAsync(0);

    const responseBody = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
    const responseBuffer = Buffer.from(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n\r\n${responseBody}`);
    mockSocket.emit('data', responseBuffer);

    await connectPromise;
  }

  describe('connect', () => {
    it('sends initialize request with correct params after socket connects', async () => {
      client = new LspClient();

      vi.mocked(parseMessages).mockImplementation((buffer: Buffer) => {
        const str = buffer.toString();
        if (str.includes('"result"')) {
          return {
            messages: [{
              jsonrpc: '2.0' as const,
              id: 1,
              result: { capabilities: {} },
            }],
            remainder: Buffer.alloc(0),
          };
        }
        return { messages: [], remainder: buffer };
      });

      const connectPromise = client.connect(6014);

      // Simulate socket connect
      mockSocket.emit('connect');
      await vi.advanceTimersByTimeAsync(0);

      // Verify encodeMessage was called with initialize request
      expect(vi.mocked(encodeMessage)).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          method: 'initialize',
          params: expect.objectContaining({
            processId: process.pid,
            capabilities: expect.objectContaining({
              textDocument: expect.objectContaining({
                publishDiagnostics: expect.objectContaining({
                  relatedInformation: true,
                }),
              }),
            }),
          }),
        }),
      );

      // Simulate receiving initialize response
      const responseBody = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
      const responseBuffer = Buffer.from(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n\r\n${responseBody}`);
      mockSocket.emit('data', responseBuffer);

      await connectPromise;

      // Verify initialized notification was sent
      expect(vi.mocked(encodeMessage)).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          method: 'initialized',
          params: {},
        }),
      );
    });

    it('rejects with descriptive error on ECONNREFUSED', async () => {
      client = new LspClient();

      const connectPromise = client.connect(6014);

      // Simulate connection error
      const error = new Error('connect ECONNREFUSED 127.0.0.1:6014') as NodeJS.ErrnoException;
      error.code = 'ECONNREFUSED';
      mockSocket.emit('error', error);

      await expect(connectPromise).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('getDiagnostics', () => {
    it('sends didOpen and resolves when publishDiagnostics arrives', async () => {
      client = new LspClient();
      await connectClient(client);

      // Reset parseMessages for diagnostics flow
      vi.mocked(parseMessages).mockImplementation((buffer: Buffer) => {
        const str = buffer.toString();
        if (str.includes('publishDiagnostics')) {
          return {
            messages: [{
              jsonrpc: '2.0' as const,
              method: 'textDocument/publishDiagnostics',
              params: {
                uri: 'file:///project/test.gd',
                diagnostics: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                    severity: 1,
                    message: 'Unexpected token',
                    source: 'gdscript',
                  },
                ],
              },
            }],
            remainder: Buffer.alloc(0),
          };
        }
        return { messages: [], remainder: buffer };
      });

      const diagPromise = client.getDiagnostics('/project/test.gd', 'var x = ;');

      await vi.advanceTimersByTimeAsync(0);

      // Verify didOpen was sent
      expect(vi.mocked(encodeMessage)).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: 'file:///project/test.gd',
              languageId: 'gdscript',
              version: 1,
              text: 'var x = ;',
            },
          },
        }),
      );

      // Simulate publishDiagnostics notification
      const diagBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///project/test.gd',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: 'Unexpected token',
              source: 'gdscript',
            },
          ],
        },
      });
      const diagBuffer = Buffer.from(`Content-Length: ${Buffer.byteLength(diagBody)}\r\n\r\n${diagBody}`);
      mockSocket.emit('data', diagBuffer);

      const result = await diagPromise;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        severity: 1,
        message: 'Unexpected token',
      }));
    });

    it('times out after 5s with empty array if no diagnostics received', async () => {
      client = new LspClient();
      await connectClient(client);

      // parseMessages returns nothing for any data
      vi.mocked(parseMessages).mockReturnValue({
        messages: [],
        remainder: Buffer.alloc(0),
      });

      const diagPromise = client.getDiagnostics('/project/test.gd', 'var x = 1');

      // Advance past the 5s timeout
      await vi.advanceTimersByTimeAsync(5001);

      const result = await diagPromise;
      expect(result).toEqual([]);
    });

    it('returns diagnostics with range, severity, message and source', async () => {
      client = new LspClient();
      await connectClient(client);

      vi.mocked(parseMessages).mockImplementation((buffer: Buffer) => {
        const str = buffer.toString();
        if (str.includes('publishDiagnostics')) {
          return {
            messages: [{
              jsonrpc: '2.0' as const,
              method: 'textDocument/publishDiagnostics',
              params: {
                uri: 'file:///project/test.gd',
                diagnostics: [
                  {
                    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
                    severity: 2,
                    message: 'Unused variable "foo"',
                    source: 'gdscript',
                  },
                ],
              },
            }],
            remainder: Buffer.alloc(0),
          };
        }
        return { messages: [], remainder: buffer };
      });

      const diagPromise = client.getDiagnostics('/project/test.gd', 'var foo = 1');
      await vi.advanceTimersByTimeAsync(0);

      const diagBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///project/test.gd',
          diagnostics: [
            {
              range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
              severity: 2,
              message: 'Unused variable "foo"',
              source: 'gdscript',
            },
          ],
        },
      });
      mockSocket.emit('data', Buffer.from(`Content-Length: ${Buffer.byteLength(diagBody)}\r\n\r\n${diagBody}`));

      const result = await diagPromise;
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
        severity: 2,
        message: 'Unused variable "foo"',
        source: 'gdscript',
      });
    });
  });

  describe('disconnect', () => {
    it('destroys socket on disconnect', async () => {
      client = new LspClient();
      await connectClient(client);

      client.disconnect();

      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('is safe to call without connection', () => {
      client = new LspClient();
      // Should not throw
      client.disconnect();
    });
  });
});
