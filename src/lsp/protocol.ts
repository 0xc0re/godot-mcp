/**
 * LSP JSON-RPC message framing layer.
 *
 * The LSP wire protocol uses `Content-Length: N\r\n\r\n{json}` framing over TCP.
 * This module provides encode/decode functions for building and parsing
 * LSP messages from raw TCP buffers.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart
 */

/**
 * A JSON-RPC 2.0 message as used by the Language Server Protocol.
 */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const HEADER_SEPARATOR = '\r\n\r\n';
const CONTENT_LENGTH_RE = /Content-Length:\s*(\d+)/i;

/**
 * Encode a JSON-RPC message with Content-Length framing per the LSP spec.
 *
 * The returned Buffer contains the header (`Content-Length: N\r\n\r\n`)
 * followed by the UTF-8 JSON body. Content-Length counts bytes, not characters.
 */
export function encodeMessage(msg: JsonRpcMessage): Buffer {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}${HEADER_SEPARATOR}`;
  return Buffer.from(header + body);
}

/**
 * Extract complete JSON-RPC messages from a raw TCP data buffer.
 *
 * Returns all fully-received messages and any unconsumed bytes as `remainder`.
 * The remainder should be prepended to the next `data` event's buffer.
 *
 * @param buffer - Raw bytes received from the TCP socket
 * @returns Parsed messages and any leftover bytes
 */
export function parseMessages(buffer: Buffer): {
  messages: JsonRpcMessage[];
  remainder: Buffer;
} {
  const messages: JsonRpcMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Look for the header/body separator
    const headerEnd = buffer.indexOf(HEADER_SEPARATOR, offset);
    if (headerEnd === -1) break;

    // Extract and parse the Content-Length header
    const header = buffer.subarray(offset, headerEnd).toString();
    const match = header.match(CONTENT_LENGTH_RE);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + HEADER_SEPARATOR.length;

    // Check if the full body has been received
    if (bodyStart + contentLength > buffer.length) break;

    // Extract and parse the JSON body
    const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString();
    messages.push(JSON.parse(body) as JsonRpcMessage);
    offset = bodyStart + contentLength;
  }

  return { messages, remainder: buffer.subarray(offset) };
}
