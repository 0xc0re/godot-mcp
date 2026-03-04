/**
 * Structured logging and MCP tool-call instrumentation.
 *
 * - `logger` writes to stderr (safe for stdio MCP transport)
 * - `wrapServerWithLogging()` monkey-patches McpServer.registerTool to
 *   automatically log every tool invocation, duration, and outcome.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function resolveLevel(): Level {
  const env = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (env in LEVELS) return env as Level;
  // Respect existing DEBUG=true convention from godot.ts
  if (process.env.DEBUG === 'true') return 'debug';
  return 'info';
}

const currentLevel = resolveLevel();

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function log(level: Level, message: string): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const tag = level.toUpperCase();
  console.error(`[GODOT-MCP] [${tag}] [${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Public logger
// ---------------------------------------------------------------------------

export const logger = {
  debug: (msg: string) => log('debug', msg),
  info: (msg: string) => log('info', msg),
  warn: (msg: string) => log('warn', msg),
  error: (msg: string) => log('error', msg),
};

// ---------------------------------------------------------------------------
// McpServer tool-call logging wrapper
// ---------------------------------------------------------------------------

/**
 * Monkey-patch `server.registerTool` so every tool callback is wrapped with
 * automatic invocation / duration / success-or-failure logging.
 *
 * Call this ONCE, BEFORE any registerXxxTools calls.
 */
export function wrapServerWithLogging(server: McpServer): void {
  const originalRegisterTool = server.registerTool.bind(server);

  (server as any).registerTool = (
    name: string,
    config: any,
    cb: (...args: any[]) => any,
  ) => {
    const wrappedCb = async (...callArgs: any[]) => {
      logger.info(`Tool called: ${name}`);
      logger.debug(`Tool args: ${JSON.stringify(callArgs[0])}`);
      const start = Date.now();
      try {
        const result = await cb(...callArgs);
        const duration = Date.now() - start;
        logger.info(`Tool completed: ${name} (${duration}ms)`);
        return result;
      } catch (err: unknown) {
        const duration = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Tool failed: ${name} (${duration}ms) - ${message}`);
        throw err;
      }
    };

    return originalRegisterTool(name, config, wrappedCb as any);
  };
}
