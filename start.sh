#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Kill any existing godot-mcp process. Match the absolute script path so we
# only ever kill THIS checkout's server -- a bare "node build/index.js"
# pattern would match any such process machine-wide.
SERVER_PATH="$(pwd)/build/index.js"
EXISTING_PID=$(pgrep -f "node $SERVER_PATH" 2>/dev/null || true)
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
# Launch with the same absolute path the pgrep above matches, so the next
# start.sh run can find (and replace) this process.
node "$SERVER_PATH"
