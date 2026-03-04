/**
 * LSP TCP client for connecting to Godot's language server.
 *
 * Stub file - implementation pending.
 */

export class LspClient {
  async connect(_port: number, _host?: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getDiagnostics(_filePath: string, _fileContent: string): Promise<unknown[]> {
    throw new Error('Not implemented');
  }

  disconnect(): void {
    // Not implemented
  }
}
