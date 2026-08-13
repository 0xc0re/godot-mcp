/**
 * LSP TCP client for connecting to Godot's language server.
 *
 * Provides connection lifecycle (connect, initialize handshake, disconnect)
 * and diagnostics retrieval (didOpen + publishDiagnostics notification).
 * Uses raw net.Socket with JSON-RPC framing from protocol.ts.
 */

import { Socket } from 'net';
import { encodeMessage, parseMessages, type JsonRpcMessage } from './protocol.js';

/** An LSP diagnostic with location, severity, and message */
export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  message: string;
  source?: string;
}

/** Timeout for collecting diagnostics after didOpen (ms) */
const DIAGNOSTICS_TIMEOUT_MS = 5000;

/** Timeout for a pending JSON-RPC request before it is rejected (ms) */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * LSP client that connects to Godot's language server over TCP.
 *
 * Usage:
 *   const client = new LspClient();
 *   await client.connect(6014);
 *   const diags = await client.getDiagnostics('/path/to/file.gd', fileContent);
 *   client.disconnect();
 */
export class LspClient {
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private notificationListeners = new Map<string, Array<(params: unknown) => void>>();
  private connected = false;

  /**
   * Connect to the LSP server and complete the initialize handshake.
   *
   * @param port - TCP port of the Godot LSP server
   * @param host - Host address (default: 'localhost')
   */
  async connect(port: number, host = 'localhost'): Promise<void> {
    this.socket = new Socket();

    // Set up data handler for TCP stream reassembly
    this.socket.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);

      let messages: JsonRpcMessage[];
      try {
        const parsed = parseMessages(this.buffer);
        messages = parsed.messages;
        this.buffer = parsed.remainder;
      } catch {
        // Malformed frame (e.g. invalid JSON body). Drop the buffered bytes so
        // one bad frame cannot crash the server or wedge the stream forever;
        // any pending request will be resolved by its timeout.
        this.buffer = Buffer.alloc(0);
        return;
      }

      for (const msg of messages) {
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          // Response to a pending request
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message));
          } else {
            pending.resolve(msg.result);
          }
        } else if (msg.method) {
          // Notification from server
          const listeners = this.notificationListeners.get(msg.method);
          if (listeners) {
            for (const listener of listeners) {
              listener(msg.params);
            }
          }
        }
      }
    });

    // Reject any in-flight requests when the connection drops, so callers
    // fail fast instead of hanging until their request timeout.
    this.socket.on('close', () => {
      this.connected = false;
      this.rejectAllPending(new Error('LSP connection closed'));
    });

    // Wait for TCP connection
    await new Promise<void>((resolve, reject) => {
      this.socket!.connect(port, host);
      this.socket!.once('connect', () => resolve());
      this.socket!.once('error', (err: Error) => reject(err));
    });

    // Send initialize request
    const initResult = await this.sendRequest('initialize', {
      processId: process.pid,
      capabilities: {
        textDocument: {
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
      },
      rootUri: null,
    });

    if (!initResult) {
      throw new Error('LSP initialize failed: no response');
    }

    // Send initialized notification
    this.sendNotification('initialized', {});
    this.connected = true;
  }

  /**
   * Request diagnostics for a GDScript file by sending textDocument/didOpen
   * and waiting for textDocument/publishDiagnostics notification.
   *
   * @param filePath - Absolute path to the GDScript file
   * @param fileContent - Full text content of the file
   * @returns Array of diagnostics (empty if timeout or clean file)
   */
  async getDiagnostics(filePath: string, fileContent: string): Promise<Diagnostic[]> {
    const uri = `file://${filePath}`;

    return new Promise<Diagnostic[]>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;

      const listener = (params: unknown) => {
        const p = params as { uri: string; diagnostics: Diagnostic[] };
        if (p.uri === uri) {
          clearTimeout(timer);
          this.removeNotificationListener('textDocument/publishDiagnostics', listener);
          resolve(p.diagnostics);
        }
      };

      this.addNotificationListener('textDocument/publishDiagnostics', listener);

      // Timeout: resolve with empty array if no diagnostics arrive
      timer = setTimeout(() => {
        this.removeNotificationListener('textDocument/publishDiagnostics', listener);
        resolve([]);
      }, DIAGNOSTICS_TIMEOUT_MS);

      // Send didOpen notification
      this.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: 'gdscript',
          version: 1,
          text: fileContent,
        },
      });
    });
  }

  /**
   * Disconnect from the LSP server gracefully.
   * Sends shutdown request and exit notification, then destroys the socket.
   */
  disconnect(): void {
    if (!this.socket) return;

    try {
      // Send shutdown request (fire-and-forget since we're disconnecting)
      this.sendNotification('shutdown', {});
      this.sendNotification('exit', {});
    } catch {
      // Ignore errors during disconnect
    }

    this.socket.destroy();
    this.socket = null;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    this.rejectAllPending(new Error('LSP client disconnected'));
    this.notificationListeners.clear();
  }

  /** Reject and clear every pending request (connection closed / disconnect). */
  private rejectAllPending(error: Error): void {
    const pending = [...this.pendingRequests.values()];
    this.pendingRequests.clear();
    for (const entry of pending) {
      entry.reject(error);
    }
  }

  /** Whether the client is currently connected */
  get isConnected(): boolean {
    return this.connected && this.socket !== null && !this.socket.destroyed;
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;

      // Reject the request if no response arrives in time, so a silent or
      // wedged server cannot leave callers hanging forever.
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: (result: unknown) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      const msg: JsonRpcMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.socket!.write(encodeMessage(msg));
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private sendNotification(method: string, params: unknown): void {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.socket!.write(encodeMessage(msg));
  }

  private addNotificationListener(method: string, listener: (params: unknown) => void): void {
    const existing = this.notificationListeners.get(method) ?? [];
    existing.push(listener);
    this.notificationListeners.set(method, existing);
  }

  private removeNotificationListener(method: string, listener: (params: unknown) => void): void {
    const existing = this.notificationListeners.get(method);
    if (existing) {
      const idx = existing.indexOf(listener);
      if (idx !== -1) existing.splice(idx, 1);
    }
  }
}
