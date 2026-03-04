import { describe, it, expect } from 'vitest';
import { encodeMessage, parseMessages, JsonRpcMessage } from '../src/lsp/protocol.js';

// ---------------------------------------------------------------------------
// encodeMessage
// ---------------------------------------------------------------------------
describe('encodeMessage', () => {
  it('produces a valid Content-Length header followed by CRLF CRLF and JSON body', () => {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    };
    const result = encodeMessage(msg);
    const str = result.toString();

    // Must start with Content-Length header
    expect(str).toMatch(/^Content-Length: \d+\r\n\r\n/);

    // Extract the header and body
    const separatorIndex = str.indexOf('\r\n\r\n');
    const header = str.substring(0, separatorIndex);
    const body = str.substring(separatorIndex + 4);

    // Content-Length value must equal byte length of body
    const match = header.match(/Content-Length: (\d+)/);
    expect(match).not.toBeNull();
    const declaredLength = parseInt(match![1], 10);
    expect(declaredLength).toBe(Buffer.byteLength(body));

    // Body must be valid JSON matching input
    const parsed = JSON.parse(body);
    expect(parsed).toEqual(msg);
  });

  it('handles UTF-8 multi-byte characters correctly (Content-Length counts bytes, not characters)', () => {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: { text: 'Hello \u{1F600} world \u00E9\u00E8' }, // emoji + accented chars
    };
    const result = encodeMessage(msg);
    const str = result.toString();

    const separatorIndex = str.indexOf('\r\n\r\n');
    const header = str.substring(0, separatorIndex);
    const body = str.substring(separatorIndex + 4);

    const match = header.match(/Content-Length: (\d+)/);
    expect(match).not.toBeNull();
    const declaredLength = parseInt(match![1], 10);

    // Byte length differs from character length for multi-byte chars
    expect(declaredLength).toBe(Buffer.byteLength(body));
    expect(declaredLength).toBeGreaterThan(body.length);
  });

  it('returns a Buffer instance', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', method: 'test' };
    const result = encodeMessage(msg);
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseMessages
// ---------------------------------------------------------------------------
describe('parseMessages', () => {
  /** Helper: create a raw LSP-framed buffer from a message object */
  function frame(msg: JsonRpcMessage): Buffer {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    return Buffer.from(header + body);
  }

  it('correctly extracts one JSON-RPC message from a raw TCP buffer', () => {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    };
    const buffer = frame(msg);
    const result = parseMessages(buffer);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(msg);
    expect(result.remainder.length).toBe(0);
  });

  it('correctly extracts two concatenated messages', () => {
    const msg1: JsonRpcMessage = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const msg2: JsonRpcMessage = { jsonrpc: '2.0', method: 'initialized' };

    const buffer = Buffer.concat([frame(msg1), frame(msg2)]);
    const result = parseMessages(buffer);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(msg1);
    expect(result.messages[1]).toEqual(msg2);
    expect(result.remainder.length).toBe(0);
  });

  it('returns the unconsumed remainder when a message is partially buffered', () => {
    const msg1: JsonRpcMessage = { jsonrpc: '2.0', id: 1, method: 'first' };
    const msg2: JsonRpcMessage = { jsonrpc: '2.0', id: 2, method: 'second' };

    const fullFrame2 = frame(msg2);
    // Include only part of the second message (half the body)
    const partialFrame2 = fullFrame2.subarray(0, Math.floor(fullFrame2.length / 2));
    const buffer = Buffer.concat([frame(msg1), partialFrame2]);
    const result = parseMessages(buffer);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(msg1);
    expect(result.remainder.length).toBe(partialFrame2.length);
    expect(result.remainder).toEqual(partialFrame2);
  });

  it('handles zero messages when buffer contains only a partial header', () => {
    const buffer = Buffer.from('Content-Le');
    const result = parseMessages(buffer);

    expect(result.messages).toHaveLength(0);
    expect(result.remainder).toEqual(buffer);
  });

  it('handles header present but incomplete body', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id: 1, method: 'test' };
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    // Include header + only partial body
    const partial = Buffer.from(header + body.substring(0, 5));
    const result = parseMessages(partial);

    expect(result.messages).toHaveLength(0);
    expect(result.remainder).toEqual(partial);
  });

  it('handles empty buffer', () => {
    const result = parseMessages(Buffer.alloc(0));
    expect(result.messages).toHaveLength(0);
    expect(result.remainder.length).toBe(0);
  });

  it('parses messages with UTF-8 multi-byte characters in body', () => {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: { text: 'caf\u00E9 \u{1F600}' },
    };
    // Use encodeMessage to build a correctly-framed buffer (once implemented)
    // For now use the helper that also uses byte length
    const buffer = frame(msg);
    const result = parseMessages(buffer);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(msg);
    expect(result.remainder.length).toBe(0);
  });
});
