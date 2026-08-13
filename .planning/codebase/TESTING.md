# Testing Patterns

**Analysis Date:** 2026-08-13 (refreshed during v2.1-hardening Track D)

## Test Framework

**Runner:**
- Vitest 4.x
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`, `vi`)

**Run Commands:**
```bash
npm test                        # Run all tests (one-shot; vitest run)
npm run test:watch              # Watch mode
npm run typecheck               # tsc --noEmit (covers src/ AND tests/)
npx vitest run --reporter=verbose  # Verbose output with test names
```

CI (.github/workflows/ci.yml) runs typecheck → build → test on Node 20 and 22.

**Stats:** 34 test files, 815 tests — all passing (derived 2026-08-13 from `npm test`, post-Track-E)

## Test File Organization

**Location:**
- Separate `tests/` directory (not co-located with source)

**Naming:**
- `tests/{domain}-tools.test.ts` for tool handler tests
- `tests/{module-name}.test.ts` for unit/parser tests
- `tests/fixtures/` for static test data files

**Structure (34 files):**
```
tests/
├── animation-tools.test.ts      # create_animation, add_keyframes, libraries
├── composition-tools.test.ts    # signals, instancing, groups, batch properties
├── config-tools.test.ts         # input actions, collision layers, autoloads
├── diagnostics-tools.test.ts    # get_diagnostics, validate_scene
├── editor-tools.test.ts         # launch_editor, run/stop_project, get_debug_output
├── error-responses.test.ts      # toolError() contract + source conformance
├── export-tools.test.ts         # export_project, presets, readiness check
├── godot-log-parser.test.ts     # structured runtime log parser (live 4.7.1 fixtures)
├── helper-autoloads.test.ts     # temporary helper injection lifecycle (inject/restore/self-heal)
├── integration.test.ts          # NO mocks: real validatePath + .tscn round-trip
├── lsp-client.test.ts           # LspClient TCP lifecycle
├── lsp-protocol.test.ts         # LSP framing encode/parse
├── output-caps.test.ts          # bounded process output windows (appendCapped)
├── path-safety.test.ts          # resolveWithinProject / ensureProject hardening
├── process-hardening.test.ts    # execGodot/executeOperation safety
├── project-parser.test.ts       # project.godot INI parser
├── project-tools.test.ts        # project settings + info tools
├── resource-registration.test.ts # MCP resource templates (scene/script)
├── resource-tools.test.ts       # read/create/modify_resource
├── run-operation.test.ts        # parseOperationOutput three-tier verdicts
├── runtime-tools.test.ts        # inspect_* IPC, restart_project, send_input, invoke_runtime, wait_for
├── scaffold-tools.test.ts       # scaffold generators + overwrite flag
├── scene-tools.test.ts          # Scene CRUD tools
├── screenshot-tools.test.ts     # capture_screenshot + resize
├── script-tools.test.ts         # validate_scripts, list_scripts, query_class
├── sdk-version.test.ts          # SDK constraint + version single-sourcing
├── shader-tools.test.ts         # shader file/material/params tools
├── signal-handlers.test.ts      # SIGINT/SIGTERM source conformance
├── testing-tools.test.ts        # run_tests (GUT runner)
├── tilemap-tools.test.ts        # create_tileset, paint_tilemap
├── tool-registration.test.ts    # registry smoke test: authoritative 68-tool roster
├── tscn-parser.test.ts          # .tscn/.tres file parser
├── tscn-writer.test.ts          # .tscn writer + escaping/injection guards
├── uid-tools.test.ts            # get_uid, update_project_uids
└── fixtures/                    # sample.project.godot, sample.tres, sample.tscn, godot-log/
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Scene MCP Tools', () => {
  let server: McpServer;
  let ctx: ServerContext;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    ctx = createTestContext();
    handlers = getToolHandlers(server);
    registerSceneTools(server, ctx);
  });

  describe('read_scene', () => {
    it('reads file and returns parsed scene JSON', async () => { ... });
    it('returns toolError for invalid paths', async () => { ... });
    it('returns toolError when project.godot missing', async () => { ... });
  });
});
```

**Patterns:**
- `beforeEach`: `vi.clearAllMocks()` + fresh server + fresh context + register tools
- Nested `describe` per tool name, flat `it` per scenario
- Test names describe behavior: `'returns toolError for invalid paths'`, `'passes correct params to executeOperation'`

## Mocking

**Framework:** Vitest `vi.mock()` with module factory pattern

**Standard Mock Stack for Tool Tests:**
```typescript
// Mock fs module (preserve actual for vi.importActual usage in some tests)
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock godot module (isolate from real Godot process). Factories are CLOSED:
// self-contained, no references to outer variables.
vi.mock('../src/godot.js', () => ({
  validatePath: vi.fn(),
  resolveWithinProject: vi.fn(),
  runOperation: vi.fn(),
  executeOperation: vi.fn(),
}));

// Mock errors module (standardized error shape for assertions)
vi.mock('../src/errors.js', () => ({
  toolError: vi.fn((message: string, suggestions: string[] = []) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, suggestions }) }],
    isError: true,
  })),
}));
```

**Tool Handler Extraction Pattern:**
Since `McpServer.registerTool()` doesn't expose handlers directly, all tool tests use this interceptor:

```typescript
function getToolHandlers(
  server: McpServer,
): Map<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = function (name: string, _config: unknown, handler: unknown) {
    handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
    return originalRegisterTool(name, _config, handler);
  } as typeof server.registerTool;

  return handlers;
}
```

**runOperation stubs:** tool handlers judge outcomes through `runOperation()`'s
`OperationResult`. Stub `{ ok: true, data: {...} }` / `{ ok: false, error: '...' }`
(plus `stdout`/`stderr`/`exitCode` when the handler inspects them) — NOT raw
stdout strings:

```typescript
vi.mocked(runOperation).mockResolvedValue({
  ok: true,
  data: { success: true },
  stdout: '{"success":true}',
  stderr: '',
  exitCode: 0,
});
```

**Path-rejection helper:** tool test files define a per-file `expectPathRejected(tool, args, paramName)`
helper that invokes the handler with a traversal-style path (`'../../evil.tres'`) and asserts the
`Invalid <param>: path resolves outside the project directory` (or `Invalid path`) error. Every tool
accepting a project-relative path gets such a case.

**What to Mock:**
- `fs` functions (`existsSync`, `readFileSync`, `writeFileSync`, `statSync`, `unlinkSync`)
- `child_process` (`execFile`, `spawn`)
- `../src/godot.js` (`validatePath`, `resolveWithinProject`, `runOperation`, `executeOperation`, `execGodot`, `trackProcess`)
- `../src/errors.js` (`toolError`) — always mocked with the same standard implementation
- `../src/parsers/tscn-parser.js` / `../src/parsers/project-parser.js` — when testing tool layer only
- LSP client (`../src/lsp/client.js`) — mock for diagnostics tool tests
- `net` — mock `Socket` class for LSP client tests

**What NOT to Mock:**
- Parser logic (`tscn-parser.ts`, `project-parser.ts`) when testing parsers directly
- LSP protocol framing (`lsp/protocol.ts`) when testing protocol unit tests
- `McpServer` from `@modelcontextprotocol/sdk` — always use real instance

## Test Context Factory

All test files define a `createTestContext()` helper returning a minimal `ServerContext`:

```typescript
function createTestContext(): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    operationsScriptPath: '/path/to/godot_operations.gd',
    activeProcess: null,
    trackedProcesses: new Set(),
    validatedPaths: new Map(),
  };
}
```

Some tests use an overrides variant:
```typescript
function createTestContext(overrides?: Partial<ServerContext>): ServerContext {
  return {
    godotPath: '/usr/bin/godot',
    ...overrides,
  };
}
```

## Fixtures and Factories

**Test Data:**
- Static fixture files in `tests/fixtures/`
- Loaded with `readFileSync` + `import.meta.dirname` path resolution

```typescript
const FIXTURES = join(import.meta.dirname, 'fixtures');

it('parses the sample.tscn fixture', () => {
  const content = readFileSync(join(FIXTURES, 'sample.tscn'), 'utf-8');
  const scene = parseScene(content);
  expect(scene.format).toBe(3);
});
```

**Inline Data:**
- Short fixtures created inline as template literals directly in test cases
- Mock data objects constructed inline per test: `const mockParsed = { type: 'StandardMaterial3D', ... }`

## Coverage

**Requirements:** None enforced (no coverage thresholds configured in `vitest.config.ts`)

**View Coverage:**
```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Pure function tests: `tscn-parser.test.ts`, `lsp-protocol.test.ts`, `project-parser.test.ts`
- No external dependencies, no mocks
- Tests cover: happy path, edge cases (empty input, partial buffers), multi-line values, UTF-8

**Integration Tests (Isolated):**
- Tool handler tests: all tests in `tests/*-tools.test.ts`
- Full handler logic exercised against a real `McpServer` instance
- Dependencies (fs, godot, LSP) fully mocked

**Conformance / Source Analysis Tests:**
- `error-responses.test.ts`: Reads source files of all tool modules and asserts they import `toolError` and don't use ad-hoc `isError:`
- `signal-handlers.test.ts`: Reads `src/index.ts` and asserts SIGINT/SIGTERM handler presence via regex
- `sdk-version.test.ts`: Parses `package.json` and asserts SDK version constraints

**Integration Tests (No Mocks):**
- `integration.test.ts`: real `validatePath` behavior + a real `.tscn` round-trip
  (fixture → tscn-parser → tscn-writer → tscn-parser), no godot.js/fs mocks

**E2E Tests:**
- Not automated — no tests invoke real Godot processes. Live smokes are manual:
  run an operation from `build/scripts/godot_operations.gd` against a scratch
  project and check the trailing JSON + exit code (pattern documented in
  CONTRIBUTING.md)

## Common Patterns

**Async Testing:**
```typescript
it('passes correct params to executeOperation', async () => {
  vi.mocked(validatePath).mockReturnValue(true);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(executeOperation).mockResolvedValue({ stdout: '{"success":true}', stderr: '' });

  const handler = handlers.get('modify_node_property')!;
  await handler({ project_path: '/my/project', ... });

  expect(executeOperation).toHaveBeenCalledWith(
    ctx,
    '/my/project',
    'modify_node_property',
    expect.objectContaining({ scenePath: 'scenes/main.tscn' }),
  );
});
```

**Error Path Testing:**
```typescript
it('returns toolError for invalid paths', async () => {
  vi.mocked(validatePath).mockReturnValue(false);

  const handler = handlers.get('read_scene')!;
  const result = await handler({
    project_path: '/my/../project',
    scene_path: 'scenes/main.tscn',
  }) as { isError?: boolean };

  expect(result.isError).toBe(true);
});
```

**Timer Testing (for polling/timeout):**
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('returns error when screenshot times out', async () => {
  const resultPromise = handler({ project_path: '/my/project' });
  await vi.advanceTimersByTimeAsync(6000);  // Past 5s timeout
  const result = await resultPromise as { isError?: boolean };
  expect(result.isError).toBe(true);
});
```

**LSP Socket Mock Pattern:**
```typescript
let mockSocket: EventEmitter & { connect: ReturnType<typeof vi.fn>; ... };

vi.mock('net', () => ({
  Socket: class MockSocket {
    constructor() { return mockSocket; }
  },
}));

// In test: emit events to drive async flows
mockSocket.emit('connect');
mockSocket.emit('data', responseBuffer);
await vi.advanceTimersByTimeAsync(0);
```

**Result Parsing for JSON Content:**
```typescript
const result = await handler({ project_path: '/my/project' })
  as { content: Array<{ type: string; text: string }> };

const parsed = JSON.parse(result.content[0].text);
expect(parsed.configVersion).toBe(5);
```

**Spy Pattern (for resource registration):**
```typescript
registerResourceSpy = vi.spyOn(server, 'registerResource');
registerGodotResources(server, ctx);

const sceneCall = registerResourceSpy.mock.calls.find(
  (call) => call[0] === 'godot-scene',
);
expect(sceneCall![1]).toBeInstanceOf(ResourceTemplate);
```

---

*Testing analysis: 2026-08-13 (v2.1-hardening Track D refresh, updated after Track E; counts from `npm test`: 34 files / 815 tests)*
