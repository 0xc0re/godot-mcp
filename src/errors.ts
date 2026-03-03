/**
 * Structured error response helpers for tool handlers.
 *
 * All tool errors should use toolError() to return a consistent JSON structure
 * with an error message and actionable suggestions.
 */

/**
 * Return type matching MCP SDK CallToolResult shape.
 * Inlined to avoid depending on SDK internal types that may move.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Create a structured error response for a tool invocation.
 *
 * Logs to stderr (safe for stdio transport) and returns a JSON body
 * that the LLM can parse for recovery suggestions.
 */
export function toolError(message: string, suggestions: string[] = []): ToolResult {
  console.error(`[SERVER] Error response: ${message}`);
  if (suggestions.length > 0) {
    console.error(`[SERVER] Possible solutions: ${suggestions.join(', ')}`);
  }

  const content: Array<{ type: 'text'; text: string }> = [
    {
      type: 'text',
      text: JSON.stringify({ error: message, suggestions }),
    },
  ];

  return { content, isError: true };
}
