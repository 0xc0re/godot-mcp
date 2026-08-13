# Contributing to Godot MCP

Thank you for considering contributing to Godot MCP! This document outlines the process for contributing to the project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How Can I Contribute?

### Reporting Bugs

- Check if the bug has already been reported in the Issues section
- Include detailed steps to reproduce the bug
- Include any relevant logs or screenshots
- Specify your environment (OS, Godot version, Node version)

### Pull Requests

1. Fork the repository
2. Create a new branch for your feature or bugfix (`git checkout -b feature/amazing-feature`)
3. Make your changes, with tests
4. Ensure `npm run typecheck` and `npm test` pass
5. Commit with clear, conventional commit messages
6. Push and open a Pull Request

CI runs `typecheck → build → test` on Node 20 and 22 for every PR; all three gates must be green.

## Development Setup

1. Clone the repository
2. `npm install`
3. `npm run build` (compiles TypeScript to `build/` and copies the GDScript payloads into `build/scripts/`)
4. For development with auto-rebuild: `npm run watch`

### Project Structure

```
godot-mcp/
├── src/
│   ├── index.ts           # Entry point (thin — reads version, starts server)
│   ├── server.ts          # ServerContext creation + module registration
│   ├── godot.ts           # Godot detection, spawning, runOperation verdicts, path safety
│   ├── logger.ts          # Structured stderr logging + tool-call instrumentation
│   ├── errors.ts          # toolError() response shape
│   ├── helper-autoloads.ts # Runtime helper autoload auto-registration
│   ├── tools/             # 16 tool modules (editor, scene, config, ...) + common.ts helpers
│   ├── parsers/           # .tscn/.tres/project.godot parsers and writers (pure TS)
│   ├── lsp/               # GDScript LSP client for diagnostics
│   ├── resources/         # MCP resource templates (godot://scene/..., godot://script/...)
│   └── scripts/           # GDScript payloads (godot_operations.gd, helpers, resize)
├── tests/                 # Vitest suite (33 files) + fixtures/
├── scripts/build.js       # Post-tsc build step (copies src/scripts → build/scripts)
├── .github/workflows/ci.yml
└── start.sh               # Rebuild + (re)launch the server
```

## Testing

### Commands

```bash
npm test            # full suite, one-shot (vitest run)
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit (covers src/ AND tests/)
npx vitest run tests/scene-tools.test.ts   # single file
```

### Test-file conventions

- `tests/{domain}-tools.test.ts` for tool handler tests, `tests/{module}.test.ts` for unit/parser tests, static fixtures in `tests/fixtures/`.
- **Closed `vi.mock` factories**: mock modules with self-contained factory functions (no references to outer variables except `vi.fn()` handles). The standard stack mocks `fs`, `../src/godot.js`, and `../src/errors.js`:

  ```typescript
  vi.mock('../src/godot.js', () => ({
    validatePath: vi.fn(),
    resolveWithinProject: vi.fn(),
    runOperation: vi.fn(),
    executeOperation: vi.fn(),
  }));
  ```

- **`runOperation` stubs**: tool handlers judge success through `runOperation()`'s `OperationResult`. Stub outcomes as `{ ok: true, data: {...} }` / `{ ok: false, error: '...' }` (plus `stdout`/`stderr`/`exitCode` when the handler inspects them) rather than raw stdout strings.
- **Handler extraction**: `McpServer.registerTool()` doesn't expose handlers, so tests intercept registration with a `getToolHandlers(server)` helper that records `name → handler` (see any `*-tools.test.ts`).
- **`expectPathRejected` helper**: path-safety cases use a shared per-file helper that calls a handler with a traversal-style argument (`'../../evil.tres'`) and asserts the `outsideProjectError`/`Invalid path` response. Every tool that accepts a project-relative path should have such a case.
- **Registry smoke test**: `tests/tool-registration.test.ts` holds the authoritative 65-tool roster (`EXPECTED_TOOLS`). Adding or removing a tool without updating it fails the suite.
- **Integration tests**: `tests/integration.test.ts` runs with *no* mocks — the real `validatePath` and a real `.tscn` parse → modify → re-parse round-trip against fixtures.

### Live smoke testing (against a real Godot)

Unit tests never spawn Godot. To verify a GDScript operation end-to-end, run it against a scratch project (a directory with a minimal `project.godot` and a `main.tscn`):

```bash
godot --headless --path /tmp/scratch-project \
  --script build/scripts/godot_operations.gd \
  modify_node_property '{"scene_path":"main.tscn","node_path":"root/DoesNotExist","property":"visible","value":false}'
echo $?   # expect {"success":false,"error":"..."} on stdout and exit code 1
```

Success paths should print trailing `{"success":true,...}` JSON and exit 0. For interactive end-to-end testing of the MCP layer itself, use `npm run inspector`.

## Adding New Tools

1. Register the tool with `server.registerTool()` in the appropriate `src/tools/*.ts` module (or create a new module and wire it in `src/server.ts`)
2. Use zod schemas for input, `withProject()` for the standard preamble, `runOperation()` for GDScript-backed operations, and `toolError()`/`opSuccess()` for responses
3. Route any project-relative path parameters through `resolveWithinProject()` (via `withProject`'s `extraPaths` and an explicit containment check)
4. If the operation needs a GDScript backend, add it to `src/scripts/godot_operations.gd` — all failure paths must go through `fail()` (JSON + exit 1)
5. Add a `tests/{domain}-tools.test.ts` describe block, including a path-rejection case
6. Update `EXPECTED_TOOLS` in `tests/tool-registration.test.ts`
7. Update the tool catalog in README.md

### Code Style

- TypeScript, strict types — avoid `any`
- Follow the existing patterns in neighboring modules; JSDoc on exported functions
- Use Node path utilities (`path.join`, etc.) — no hardcoded separators
- Handle errors with `toolError()` and actionable suggestions

## Debugging

1. Set `LOG_LEVEL=debug` (or `DEBUG=true`) for verbose server-side logging to stderr
2. Set `GODOT_DEBUG=true` to pass `--debug-godot` to Godot operation spawns
3. Use the MCP Inspector for interactive debugging: `npm run inspector`

## Documentation

- Keep the README tool catalog in sync with `EXPECTED_TOOLS`
- Document behavior changes (exit codes, response shapes) in the README's behavior-changes section

## Questions?

If you have any questions about contributing, feel free to open an issue for discussion.

Thank you for your contributions!
