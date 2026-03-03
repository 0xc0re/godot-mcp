# Technology Stack

**Analysis Date:** 2026-03-03

## Languages

**Primary:**
- TypeScript 5.3.3 - Main server implementation (`src/index.ts`)
- GDScript - Godot engine scripting for complex operations (`src/scripts/godot_operations.gd`)

**Secondary:**
- JavaScript - Build tooling and Node.js runtime

## Runtime

**Environment:**
- Node.js 18.0.0 or higher (see `package.json` engines field)

**Package Manager:**
- npm (with lock file: `package-lock.json`)

## Frameworks

**Core:**
- @modelcontextprotocol/sdk 0.6.0 - MCP (Model Context Protocol) server implementation for AI assistant integration

**Build/Dev:**
- TypeScript 5.3.3 - Type checking and transpilation
- @types/node 20.11.24 - Type definitions for Node.js APIs

## Key Dependencies

**Critical:**
- @modelcontextprotocol/sdk 0.6.0 - Provides Server class, StdioServerTransport, and types for MCP protocol implementation (imports from `src/index.ts` lines 16-23)
- fs-extra 11.2.0 - Enhanced filesystem utilities for build process (file copying, directory management)
- axios 1.7.9 - HTTP client library (imported but primarily unused in current codebase)

**Infrastructure:**
- content-type 1.0.5 - Content type parsing (transitive dependency via MCP SDK)
- raw-body 3.0.0 - Parse raw request bodies (transitive dependency via MCP SDK)
- zod 3.23.8 - TypeScript-first schema validation (transitive dependency via MCP SDK)

## Configuration

**Environment:**
- `DEBUG` - Set to `"true"` to enable detailed server-side debug logging (line 26 in `src/index.ts`)
- `GODOT_PATH` - Override automatic Godot executable detection with custom path (line 278 in `src/index.ts`)

**Build:**
- `tsconfig.json` - TypeScript compiler configuration targeting ES2022, ESNext modules
  - Output directory: `./build`
  - Source root: `./src`
  - Strict mode enabled

**Package Metadata:**
- Entry point: `build/index.js` (binary: `godot-mcp`)
- Files included in npm package: `build/` directory only
- License: MIT
- Type: ESM (ECMAScript modules)

## Platform Requirements

**Development:**
- Node.js >= 18.0.0
- npm for package management
- TypeScript compiler
- Godot Engine installed on system (any supported version for testing)

**Production:**
- Node.js >= 18.0.0
- Godot Engine installed on the system running the MCP server
- AI assistant supporting MCP protocol (Cline, Cursor, or similar)

## Build Process

**Scripts:**
- `npm run build` - Compile TypeScript and run build post-processing (`tsc && node scripts/build.js`)
- `npm run watch` - Watch mode TypeScript compilation (`tsc --watch`)
- `npm run inspector` - Launch MCP inspector tool for debugging
- `npm run prepare` - Pre-publish hook that runs build

**Build Post-Processing:**
- `scripts/build.js` - Makes `build/index.js` executable (chmod 755) and copies `src/scripts/godot_operations.gd` to `build/scripts/`

## Output & Distribution

**Build Artifacts:**
- `build/index.js` - Compiled and executable MCP server entry point
- `build/scripts/godot_operations.gd` - Bundled GDScript operations file for Godot

**Distribution:**
- npm package (https://registry.npmjs.org/@modelcontextprotocol/sdk)
- GitHub repository: https://github.com/Coding-Solo/godot-mcp

---

*Stack analysis: 2026-03-03*
