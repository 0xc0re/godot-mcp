# Codebase Concerns

**Analysis Date:** 2026-03-03

## Tech Debt

### Weak Type Safety with `any` Types

**Issue:** Multiple function parameters and variables use the `any` type, reducing type safety and IDE support.

**Files:** `src/index.ts` (lines 39, 58, 1531, 1546, 1627, 1642, 1731, 1746, 1794, 2034)

**Impact:** Reduces compile-time error detection, makes refactoring risky, and decreases code maintainability. API contract changes in MCP SDK could go undetected.

**Fix approach:**
- Replace `any` types with explicit interfaces
- Create proper type definitions for `GodotProcess.process` (currently `any`)
- Create typed parameter interfaces for each handler method instead of `args: any`
- Add strict type checking in tsconfig.json with `noImplicitAny: true`

### Hard-coded Debug Mode Configuration

**Issue:** `GODOT_DEBUG_MODE` is hardcoded to `true` and cannot be disabled at runtime.

**Files:** `src/index.ts` (lines 27, 107-114, 512-514)

**Impact:** Always adds `--debug-godot` flag to Godot operations regardless of environment needs. Cannot optimize for production scenarios where debug output is not required.

**Fix approach:**
- Accept `GODOT_DEBUG_MODE` from environment variable with default value
- Pass this setting through to the executeOperation method
- Allow runtime configuration override via config object

### Monolithic Server Class

**Issue:** All functionality is contained in a single 2196-line `GodotServer` class in `src/index.ts`.

**Files:** `src/index.ts`

**Impact:**
- Difficult to test individual components in isolation
- Hard to maintain and navigate the codebase
- Mixes concerns: server setup, tool handlers, path detection, process management, parameter normalization
- Tool handlers are 12+ deeply nested methods

**Fix approach:**
- Split into separate modules:
  - `PathDetection.ts` - Godot path detection and validation
  - `ProcessManager.ts` - Spawning and managing Godot processes
  - `ToolHandlers.ts` - Individual handler implementations
  - `ParameterNormalizer.ts` - Parameter conversion logic
  - `Server.ts` - MCP server setup and communication

### Repeated Error Handling Pattern

**Issue:** Almost every handler method has identical try-catch error handling with similar error messages and suggestions.

**Files:** `src/index.ts` (lines 1026-1035, 1131-1140, 1532-1539, 1627-1635, 1731-1739, etc.)

**Impact:** Code duplication makes it hard to update error handling strategy globally. Each handler independently catches and formats errors.

**Fix approach:**
- Create an error handling wrapper/decorator
- Centralize error response formatting
- Use a consistent error catalog with standard messages

---

## Known Bugs

### Process Cleanup Race Condition

**Issue:** When stopping a process via `handleStopProject`, the process may emit 'exit' or 'error' events after being killed, causing potential state inconsistency.

**Files:** `src/index.ts` (lines 1190-1193, 1107-1119)

**Symptoms:**
- `activeProcess` could be set to null twice
- Error handlers might reference a process that's already been cleaned up
- Race condition between manual kill and natural exit

**Workaround:** The code checks `if (this.activeProcess && this.activeProcess.process === process)` before nullifying, which provides some protection, but timing is still an issue.

**Fix approach:**
- Use a process state flag instead of null checks
- Add a timeout-based cleanup
- Ensure all listeners are removed before nullification
- Use `process.once()` for exit/error handlers instead of `on()`

### Path Validation Bypass

**Issue:** `validatePath()` method only checks for `..` and empty strings but doesn't prevent other path traversal techniques or symlink attacks.

**Files:** `src/index.ts` (lines 207-215)

**Symptoms:** Paths like `..%2F` (URL encoded), `....//`, or symlinks to sensitive directories could bypass validation.

**Trigger:** Any tool that accepts a path parameter (e.g., `launch_editor`, `run_project`)

**Workaround:** The code uses `execFile` with argument arrays (not shell), which mitigates command injection, but path validation itself is weak.

**Fix approach:**
- Use `path.resolve()` to get absolute paths and verify they're within project directory
- Add checks for symlinks with `fs.realpathSync()`
- Validate against allowed directory whitelist if possible
- Use `path.relative()` to ensure normalized relative paths

### Fallback Godot Path Not Validated

**Issue:** In non-strict mode, if Godot is not found, the code falls back to a hardcoded default path that may not exist, and this invalid path is used for subsequent operations.

**Files:** `src/index.ts` (lines 343-355, 2154-2175)

**Impact:** Operations will fail silently or with cryptic error messages when the fallback path is invalid. This can lead to confusing error states where the server appears to work but actually can't execute Godot.

**Trigger:** Server starts with no valid Godot installation found, non-strict mode enabled

**Fix approach:**
- In non-strict mode, still warn prominently but validate the fallback path
- Add a "needs_reconfiguration" flag to server state
- Require explicit Godot path via config before allowing tool operations
- Add server health check endpoint to validate paths before accepting requests

---

## Security Considerations

### Environment Variable Exposure in Logs

**Issue:** Debug logging outputs file paths, operation parameters, and environment variables that might contain sensitive information.

**Files:** `src/index.ts` (lines 136, 170-172, 479-480, 516)

**Risk:** Debug logs written to stderr could be captured by CI/CD systems, log aggregators, or exposed in bug reports. Parameters passed to operations might contain absolute paths or other system information.

**Current mitigation:** Only enabled when `DEBUG === 'true'` environment variable is set

**Recommendations:**
- Sanitize logged paths to show only relative paths from project root
- Never log parameter contents, only parameter names
- Add log redaction patterns for common sensitive data
- Document that DEBUG mode should never be enabled in production

### PATH Injection via spawn()

**Issue:** While `execFile` (used for validation) prevents shell injection, some operations use `spawn` with stdio: 'pipe', which could theoretically expose PATH environment variables.

**Files:** `src/index.ts` (lines 1010, 1087)

**Risk:** Moderate - mitigated by use of `execFile` for actual operations, but spawn is used for editor launching which is intentional.

**Current mitigation:** Arguments are passed as array, not interpolated into shell command

**Recommendations:**
- Consider using `execFile` instead of `spawn` where possible
- Document why `spawn` is used and why it's safe
- Add explicit `PATH` and `HOME` validation in environment

### Input Validation Insufficient for Node Paths

**Issue:** Node path parameters (e.g., "root/Player/Sprite2D") are validated only for `..` but not for special Godot node path syntax that could cause issues.

**Files:** `src/index.ts` (lines 1653-1662, 1821-1830)

**Risk:** Low - Godot operations script would reject invalid node paths, but no client-side validation

**Recommendations:**
- Add regex validation for node paths (alphanumeric, forward slash, underscore)
- Document expected node path format
- Return clear error messages for invalid node paths

---

## Performance Bottlenecks

### Synchronous Path Validation in Constructor

**Issue:** Constructor performs synchronous file system operations during initialization (`isValidGodotPathSync`, `existsSync`).

**Files:** `src/index.ts` (lines 100-132, 224-232)

**Problem:** Even though called once at startup, blocks event loop during initialization. If file system is slow, server startup is delayed.

**Improvement path:**
- Move sync checks to async startup phase in `run()` method
- Make constructor fully async-compatible
- Add timeout for path validation operations

### Cache Map May Grow Unbounded

**Issue:** `validatedPaths` Map is never cleared and accumulates entries for every path checked during server lifetime.

**Files:** `src/index.ts` (lines 69, 239-240, 249-262)

**Problem:** Long-running servers could accumulate memory over time if many different paths are validated.

**Improvement path:**
- Add cache size limit (LRU eviction)
- Add cache TTL (expire entries after N hours)
- Add manual cache clear method for testing

### Recursive Directory Search Not Limited

**Issue:** `findGodotProjects` performs unbounded recursive search through directory tree.

**Files:** `src/index.ts` (lines 593-651)

**Problem:** If user accidentally runs on `/` or large directory with deep nesting, could exhaust file descriptors or timeout.

**Improvement path:**
- Add maximum depth parameter
- Add timeout for search operations
- Add file count limit before stopping search
- Document recursion depth in tool description

### Output/Error Arrays Accumulate Without Limit

**Issue:** `GodotProcess.output` and `errors` arrays are never trimmed and can grow indefinitely for long-running processes.

**Files:** `src/index.ts` (lines 1088-1105, 1121, 1091-1105)

**Problem:** Very long process runs (hours of gameplay testing) could exhaust memory with accumulated console output.

**Improvement path:**
- Implement circular buffer (limited size, discard oldest)
- Add configurable output limit
- Add option to stream output to file instead of memory
- Document memory implications for long runs

---

## Fragile Areas

### Parameter Normalization Not Comprehensive

**Files:** `src/index.ts` (lines 414-440, 447-465, 76-92)

**Why fragile:**
- Parameter mappings are manually maintained in two places (snake_case to camelCase and reverse)
- Adding new parameters requires updating `parameterMappings` AND `reverseParameterMappings`
- Easy to miss one direction, causing silent parameter failures
- Recursive normalization could fail on deeply nested objects
- No validation that all parameters are properly mapped

**Safe modification:**
- Add test that generates reverse mappings programmatically
- Validate all tool schemas have corresponding mappings
- Add type generation from single source of truth

### Version Detection Fragile

**Issue:** Version parsing uses regex that may not handle all Godot version formats.

**Files:** `src/index.ts` (lines 399-407)

**Problem:** Regex `/^(\d+)\.(\d+)/` only looks at first two version numbers. Edge cases:
- Alpha/beta versions (e.g., "4.3.0-beta1")
- Development versions
- Custom builds

**Safe modification:**
- Add comprehensive version parsing tests
- Document supported version formats
- Add fallback to assume latest when parsing fails

### Tool Definitions and Handler Switch Statement Must Stay Synchronized

**Issue:** Tool definitions in `setupToolHandlers` (lines 659-917) and handler switch statement (lines 920-956) are separate and must stay in sync.

**Files:** `src/index.ts`

**Problem:** If tool name defined as "launch_editor" but handler case is "launchEditor", the tool won't work. No type checking ensures they match.

**Safe modification:**
- Generate tool definitions and switch cases from single enum or configuration
- Add test that verifies every tool in definition list has a handler
- Use `satisfies` TypeScript feature to validate type safety

### Godot Operations Script Not Validated at Start

**Issue:** The Godot operations script path is set in constructor but not validated to exist.

**Files:** `src/index.ts` (lines 135-136)

**Problem:** Script is only referenced at operation time. If script is missing (build failed, file deleted), errors only occur when first tool runs.

**Safe modification:**
- Check file existence in constructor
- Move check to `run()` method to fail fast
- Include script contents hash in version info for debugging

---

## Scaling Limits

### Single Active Process Only

**Current capacity:** 1 Godot process at a time

**Limit:** Server can only manage one running project. Multiple clients requesting `run_project` simultaneously will kill previous process.

**Scaling path:**
- Add process pool with configurable max processes
- Implement process lifecycle management
- Return process IDs to clients
- Add process list/status query tools

### No Request Queuing

**Current state:** Tool operations are executed immediately without queuing

**Scaling path for high concurrency:**
- Implement request queue for path operations
- Add timeout and backpressure for slow file systems
- Document that operations are not atomic (process could be killed mid-operation)

---

## Dependencies at Risk

### axios 1.7.9 (Unused)

**Risk:** Dependency appears in package.json but is not imported or used anywhere in the codebase.

**Files:** `package.json` (line 37)

**Impact:** Dead dependency creates supply chain risk with no benefit

**Migration plan:** Remove from package.json and package-lock.json. If needed in future, re-add with rationale.

### fs-extra 11.2.0 with Custom build.js Script

**Risk:** Using fs-extra for basic file operations (chmod, copy) in build script.

**Files:** `scripts/build.js`, `package.json`

**Alternative:** Standard `fs` module provides all needed functionality in Node.js 18+

**Migration plan:** Replace fs-extra calls with native fs operations in build.js

### form-data Vulnerability History

**Risk:** According to git history, form-data has had unsafe vulnerabilities fixed. Indirect dependency through axios/other packages.

**Files:** `package-lock.json` contains form-data transitive dependency

**Recent fix:** Commit ab02801 shows "npm dependencies form-data unsafe + axios DoS"

**Recommendation:** Keep axios updated, audit transitive dependencies regularly, add `npm audit` to CI pipeline

---

## Missing Critical Features

### No Input Rate Limiting

**Problem:** MCP server accepts unlimited rapid requests without throttling

**Blocks:** High-frequency clients from accidentally causing resource exhaustion

**Recommendation:** Add per-client request rate limiting (if multi-client support added)

### No Persistent Process State

**Problem:** If MCP server crashes, active processes are orphaned - they continue running but become inaccessible

**Blocks:** Reliable process management in production scenarios

**Recommendation:** Implement process state file or PID tracking across server restarts

### No Tool Permission System

**Problem:** All tools are available to all clients without authorization

**Blocks:** Multi-user scenarios where some users should have restricted access

**Recommendation:** Add role/permission system (out of scope for single-client MCP but good for future)

---

## Test Coverage Gaps

### No Unit Tests Exist

**Untested areas:**
- Path detection logic (complex platform-specific logic with fallbacks)
- Parameter normalization (could silently fail to map parameters)
- Version comparison (regex-based version parsing)
- Error handling in all 12+ handler methods

**Files:** `src/index.ts` (entire file - no test files in repository)

**Risk:** High

**Priority:** High - Should add tests before refactoring

**Test plan:**
1. Create `src/tests/` directory
2. Add PathDetection.test.ts - test all platform paths
3. Add ParameterNormalizer.test.ts - test mapping bidirectionality
4. Add ErrorHandling.test.ts - test each error code path
5. Mock Godot processes for integration tests
6. Set up GitHub Actions to run tests on PR

### Process Lifecycle Not Tested

**What's not tested:**
- Multiple sequential process starts
- Process killed while getting output
- Output collection for long-running processes
- Exit/error event timing race conditions

**Risk:** Medium - fragile area with known race condition

**Recommendation:** Add integration tests with controlled Godot process spawning

### Path Validation Not Tested

**What's not tested:**
- Windows vs Unix path handling
- Symlink handling
- Relative vs absolute path resolution
- .. traversal prevention

**Risk:** Medium - security implications

**Recommendation:** Add unit tests for `validatePath` with various attack patterns

---

*Concerns audit: 2026-03-03*
