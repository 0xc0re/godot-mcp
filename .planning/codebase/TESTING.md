# Testing Patterns

**Analysis Date:** 2026-03-03

## Test Framework

**Status:** Not detected

**No test framework configured.**

- No jest.config.* files found
- No vitest.config.* files found
- No test scripts in package.json
- No test files (*.test.ts, *.spec.ts) in source directory
- No testing dependencies in package.json (no jest, vitest, mocha, chai, etc.)

**Current Testing Approach:**
The codebase appears to rely on:
1. Manual/integration testing with actual Godot executable
2. Inspector tool for MCP protocol testing: `npm run inspector`
3. No automated test suite

## Package.json Scripts

```json
{
  "scripts": {
    "build": "tsc && node scripts/build.js",
    "inspector": "npx @modelcontextprotocol/inspector build/index.js",
    "prepare": "npm run build",
    "watch": "tsc --watch"
  }
}
```

**Available Commands:**
- `npm run build` - Compile TypeScript and run build script
- `npm run inspector` - Launch MCP inspector for manual testing
- `npm run watch` - Watch mode for TypeScript compilation
- `npm test` - NOT IMPLEMENTED

## Testing Infrastructure Gaps

**Critical Gaps:**
1. **No test runner** - Need to add vitest, jest, or mocha
2. **No test files** - 2196-line monolithic source file has zero test coverage
3. **No assertion library** - Would need chai, assert, or built-in equivalents
4. **No mock framework** - Mocking external processes and file system operations
5. **No CI test execution** - No test scripts in package.json to run in CI/CD

## Areas That Would Require Testing

Based on codebase analysis (`src/index.ts`), these areas lack test coverage:

**Path Validation (lines 207-215):**
- `validatePath()` - path traversal prevention
- `isValidGodotPathSync()` - synchronous path validation
- `isValidGodotPath()` - async path validation with caching

**Godot Detection (lines 270-362):**
- `detectGodotPath()` - platform-specific path detection
- Environment variable loading (GODOT_PATH)
- Platform-specific fallback paths (Darwin, Linux, Windows)

**Parameter Normalization (lines 414-472):**
- `normalizeParameters()` - snake_case to camelCase conversion
- `convertCamelToSnakeCase()` - reverse conversion
- Recursive handling of nested objects
- Parameter mapping tables

**Tool Handlers (lines 964-1850+):**
- `handleLaunchEditor()` - project.godot validation, spawn process
- `handleRunProject()` - process lifecycle, output capture
- `handleGetDebugOutput()` - output buffer management
- `handleStopProject()` - process termination
- `handleCreateScene()` - operation execution
- `handleAddNode()` - parameter validation
- `handleGetProjectInfo()` - file I/O, JSON parsing
- `handleListProjects()` - directory traversal, filtering

**Operation Execution (lines 474-535):**
- `executeOperation()` - shell command construction safety
- Process spawning with JSON parameter passing
- stderr/stdout capture
- Error handling for execFile failures

**Project Discovery (lines 593-650):**
- `findGodotProjects()` - recursive directory search
- project.godot file detection
- Project filtering and naming

## Recommended Testing Strategy

**Phase 1: Setup**
Install testing framework and create first test:
```bash
npm install --save-dev vitest @vitest/ui
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'build/',
      ]
    }
  },
});
```

**Phase 2: Unit Tests**
Create `src/index.test.ts` with:
- Path validation tests
- Parameter normalization tests
- Type conversions (camelCase ↔ snake_case)
- Version string parsing

**Phase 3: Integration Tests**
Mock file system and child processes:
```typescript
// Example structure
describe('GodotServer', () => {
  beforeEach(() => {
    vi.mock('child_process');
    vi.mock('fs');
  });

  describe('detectGodotPath', () => {
    it('should find godot in PATH');
    it('should use GODOT_PATH environment variable');
    it('should validate path before returning');
  });

  describe('normalizeParameters', () => {
    it('should convert snake_case to camelCase');
    it('should handle nested objects');
    it('should preserve unknown keys');
  });

  describe('handleLaunchEditor', () => {
    it('should validate project.godot exists');
    it('should spawn process with correct arguments');
    it('should return error if Godot path not found');
  });
});
```

**Phase 4: Mocking Strategy**
Key modules to mock:
- `child_process.spawn()` and `execFile()` - mock process lifecycle
- `fs` operations - mock file existence checks
- `@modelcontextprotocol/sdk` - mock Server and schema validation

## Testing Patterns to Implement

**Error Testing Pattern:**
```typescript
describe('error handling', () => {
  it('should return error response for missing parameters', async () => {
    const server = new GodotServer();
    const result = await server.handleLaunchEditor({ /* no projectPath */ });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Project path is required');
  });

  it('should include possible solutions in error response', async () => {
    const result = /* error response */;

    expect(result.content.length).toBeGreaterThan(1);
    expect(result.content[1].text).toContain('Possible solutions');
  });
});
```

**Async Testing Pattern:**
```typescript
describe('async operations', () => {
  it('should handle process spawning', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: '4.4.0\n',
      stderr: ''
    });

    const server = new GodotServer();
    const result = await server.handleGetGodotVersion();

    expect(result.content[0].text).toBe('4.4.0');
  });
});
```

**File I/O Testing Pattern:**
```typescript
describe('file operations', () => {
  it('should read project.godot for configuration', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      'config/name="MyProject"\n[application]'
    );

    const info = await server.handleGetProjectInfo({
      projectPath: '/path/to/project'
    });

    expect(info).toContain('MyProject');
  });
});
```

## Coverage Targets

**Recommended Minimum Coverage:**
- Statements: 70% (high priority for critical paths)
- Branches: 60% (focus on error conditions)
- Functions: 80% (cover all handlers)
- Lines: 70%

**High-Priority Coverage Areas:**
1. Path validation (`validatePath()`, `isValidGodotPath*()`) - security sensitive
2. Parameter normalization - affects all tool execution
3. Error responses - user-facing critical
4. Tool handlers - main entry points
5. Operation execution - interfaces with Godot

**Lower-Priority Areas (may skip for MVP):**
- Platform-specific detection fallbacks
- Version parsing edge cases
- Project structure traversal (integration test better)

## Running Tests

**Once implemented, commands will be:**
```bash
npm run test              # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Generate coverage report
npm run test:ui         # Interactive UI
```

**Add to package.json:**
```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:ui": "vitest --ui"
  }
}
```

## Current Validation Approach

Since no automated tests exist, the project uses:

**Manual Validation:**
- `npm run build` - TypeScript compilation validates syntax and types
- `npm run inspector` - MCP protocol validator tests running server
- Manual testing with actual Godot executable

**Type Safety:**
- `tsconfig.json` with `"strict": true` catches type errors at compile time
- Strong typing of interfaces and class members

**Code Quality:**
- No linting rules enforced (no ESLint)
- Manual review of contributions required

---

*Testing analysis: 2026-03-03*

**Recommendation:** Implement vitest-based test suite starting with unit tests for `GodotServer` class. Priority should be path validation and error handling patterns which are security and user-experience critical.
