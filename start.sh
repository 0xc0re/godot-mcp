#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Kill any existing godot-mcp process
EXISTING_PID=$(pgrep -f "node build/index.js" 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  echo "Killing existing godot-mcp process (PID: $EXISTING_PID)..."
  kill $EXISTING_PID 2>/dev/null || true
  sleep 1
  # Force kill if still running
  kill -9 $EXISTING_PID 2>/dev/null || true
fi

echo "Building..."
npm run build

echo "Starting godot-mcp server..."
node build/index.js
