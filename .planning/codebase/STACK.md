# Technology Stack

**Analysis Date:** 2026-03-03

## Languages

**Primary:**
- TypeScript 5.3.3 - All server logic, tool implementations, parsers, LSP client
- GDScript (Godot 4.x) - Headless operations script bundled with the server

**Secondary:**
- JavaScript (ES module) - Build script at `scripts/build.js`, post-compile chmod/copy
- Bash - Dev launcher script at `start.sh`

## Runtime

**Environment:**
- Node.js >=18.0.0 (required, enforced via `engines` field in `package.json`)

**Package Manager:**
- npm (no version pinned)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` ^1.27.1 - MCP server framework: `McpServer`, `StdioServerTransport`, `ResourceTemplate`

**Testing:**
- `vitest` ^4.0.18 - Test runner and assertion library; config at `vitest.config.ts`

**Build/Dev:**
- `typescript` ^5.3.3 - TypeScript compiler (`tsc`); config at `tsconfig.json`
- `fs-extra` ^11.2.0 - Used in `scripts/build.js` for post-build file copies

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` ^1.27.1 - The entire server is built on this SDK. Provides `McpServer`, tool registration, resource registration, and `StdioServerTransport`. Imported from `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js`.
- `zod` ^3.25.76 - Schema validation for all tool `inputSchema` definitions. Every tool parameter is declared as a Zod schema object.

**Infrastructure:**
- `fs-extra` ^11.2.0 - Used only in `scripts/build.js` for `ensureDirSync` and `copyFileSync`; not imported in runtime source
- Node.js built-ins used heavily: `child_process` (execFile, spawn), `fs` (existsSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync), `net` (Socket for LSP TCP), `path`, `url`, `util`

## Configuration

**TypeScript:**
- `tsconfig.json` at project root
- Target: `ES2022`
- Module system: `nodenext` (ESM)
- Output: `./build/`
- Source root: `./src/`
- Strict mode: enabled
- `resolveJsonModule`: true

**Build:**
- Compile step: `tsc` outputs to `build/`
- Post-compile step: `node scripts/build.js` copies GDScript files and sets `build/index.js` executable
- Full build command: `npm run build` (runs `tsc && node scripts/build.js`)
- Watch mode: `npm run watch` (runs `tsc --watch`, no post-compile step)

**Testing:**
- `vitest.config.ts` at project root
- Test glob: `tests/**/*.test.ts`

**Environment Variables:**
- `GODOT_PATH` - Override auto-detected Godot executable path
- `GODOT_PROJECT_PATH` - Project root for MCP resource listing (godot://scene/ and godot://script/)
- `DEBUG=true` - Enable verbose `[DEBUG]` stderr logging in godot.ts and editor.ts

## Platform Requirements

**Development:**
- Node.js >=18.0.0
- Godot 4.x installed (auto-detected or set via `GODOT_PATH`)
- TypeScript compiler (installed as devDependency)

**Production:**
- Distributed as npm package (`godot-mcp`), entry point: `./build/index.js`
- Consumed as a stdio MCP server — clients connect via stdio pipe
- Godot executable must be available on target machine
- The `build/` directory is the published artifact (`.gitignore` excludes it; `files` in `package.json` includes only `build`)

---

*Stack analysis: 2026-03-03*
