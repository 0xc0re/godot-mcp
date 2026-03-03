# Feature Research

**Domain:** MCP server for Godot Engine game development
**Researched:** 2026-03-03
**Confidence:** HIGH (competitor landscape), MEDIUM (Claude Code expectations), HIGH (Godot 4.x capabilities)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Launch Godot editor | Every Godot MCP server has this; it's the entry point | LOW | Already implemented |
| Run project and capture output | Core loop: change → run → inspect | LOW | Already implemented |
| Stop running project | Cannot run without stop | LOW | Already implemented |
| Get debug output | AI must see errors to fix them | LOW | Already implemented |
| Create scene file | Scenes are Godot's fundamental unit | MEDIUM | Already implemented; creates .tscn |
| Add node to scene | Cannot build scene structure without it | MEDIUM | Already implemented |
| Read/inspect scene tree | AI needs to understand what currently exists before modifying | MEDIUM | NOT YET implemented — critical gap |
| Read GDScript file | AI must read a script before it can modify it | LOW | Files are on disk; readable via filesystem but not via MCP tool |
| Create GDScript file | Creating scripts is the primary coding activity | LOW | Already implemented |
| Update GDScript file | Editing existing scripts is the primary coding activity | LOW | Already implemented |
| List project files | AI needs to understand project structure | LOW | Already implemented |
| Get project info | Version, name, main scene — basic orientation | LOW | Already implemented |
| Get Godot version | Required for compatibility checks | LOW | Already implemented |
| SDK compatibility with Claude Code | Tools must be discoverable by Claude Code | HIGH | Known critical bug — SDK v0.6.0 causes tool invisibility |
| Actionable error messages | "Command failed" is useless; "Missing scene file, create it with create_scene" is useful | MEDIUM | Partially implemented; needs improvement |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Headless scene tree inspection (read .tscn as JSON) | AI can understand existing scene structure without running the game | MEDIUM | tugcantopaloglu/godot-mcp and GoPeak do this; competitive baseline is moving up |
| Modify node properties headlessly | AI can change properties without interactive editor session | MEDIUM | Requires GDScript operation layer already in place |
| Remove node from scene | Enables refactoring; can't do clean work without it | MEDIUM | Missing from current implementation |
| Read project.godot settings | AI needs to know autoloads, render mode, physics layers | LOW | Can be done via file parsing; tugcantopaloglu has this |
| Modify project.godot settings | Configure autoloads, input maps, render mode via AI | MEDIUM | High value for scaffolding new projects |
| GDScript diagnostics via LSP | Real-time syntax/type errors without running the project | HIGH | GoPeak does this via Godot's LSP (port 6005); ryanmazzolini has a standalone server for this |
| Attach script to node headlessly | AI can wire up scripts as it builds scenes | MEDIUM | Part of tugcantopaloglu's headless scene ops |
| Create resource files (.tres) | Materials, curves, atlases — needed for polished games | MEDIUM | tugcantopaloglu has this |
| Read resource files (.tres) | AI needs to inspect resources it will modify | LOW | Parseable as text; Godot 4 .tres is structured text |
| List project scripts with structure summary | AI can get "what scripts exist and what they export" in one call | MEDIUM | Requires LSP or headless introspection |
| ClassDB introspection | "What properties does CharacterBody2D have?" — eliminates AI hallucinating wrong property names | HIGH | GoPeak implements this; reduces hallucination significantly |
| Export project headlessly | Build for Web/Windows/Linux via MCP — enables CI use cases | HIGH | Godot 4 supports `--export-release --headless`; complex to wrap safely |
| Scan for GDScript parse errors | Batch validate all scripts in project without running | MEDIUM | Can use `godot --check-only --headless` |
| Runtime scene tree inspection | Walk the live scene tree during a running game | HIGH | Requires either DAP/debugger protocol or injected GDScript; GoPeak uses DAP |
| Screenshot capture | AI can see what the game currently looks like | HIGH | Requires running game and window capture; GDAI MCP has this |
| MCP resources for current scene/script | Claude Code can `@mention` the current scene as context | MEDIUM | ee0pdt/Godot-MCP exposes `godot://scene/current` as an MCP resource |
| Tool search / pagination | 95 tools destroy context budget; on-demand discovery is essential at scale | MEDIUM | Claude Code natively supports `list_changed` notifications and Tool Search |
| `.mcp.json` project-scope config | Commit server config to repo so teammates get it automatically | LOW | Claude Code project-scope MCP is stored in `.mcp.json`; just documentation/convention |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| 149 tools in one server | More tools = more capable | Destroys context budget (55k tokens before first message); LLM confusion from tool overload; Claude Code Tool Search activates auto at 10% of context window | Keep focused at ~25 well-named tools; group by composability not coverage |
| Runtime arbitrary code execution | "Execute any GDScript" is maximally flexible | Shell injection vector; can crash or corrupt game state; hard to sandbox | Expose specific parameterized operations (call_method, set_property) rather than free-form eval |
| Replace Godot editor entirely | Seems like the AI "takes over" | Users still need the editor for visual work; AI assistance != replacement | Augment the editor workflow; surface MCP tools that complement the editor |
| Godot 3.x support | Backward compatibility | Godot 3.x and 4.x APIs are incompatible; two divergent codebases for an audience that's moved on | Document Godot 4.x requirement clearly; do not add 3.x shims |
| Built-in asset generation (AI art, audio) | One-stop shop sounds appealing | Out of scope for an engine integration server; better handled by dedicated tools (Stable Diffusion MCP, etc.) | Integrate with CC0 asset libraries (Kenney, Poly Haven) via search/download, not generation |
| HTTP transport / remote access | "Use from cloud IDE" use case | Local Godot process cannot be accessed remotely; security implications of exposing file system operations over HTTP | Keep stdio transport; Godot is a local tool |
| Project-level code review / full-project AI analysis | "Review my whole game" | Token budget explosion; MCP output limit is 25k tokens by default | Provide targeted tools (scan errors, list scripts) and let the AI compose the analysis |

---

## Feature Dependencies

```
[SDK compatibility fix]
    └──required by──> ALL other tools (tools invisible without this)

[Read scene tree (headless)]
    └──required by──> [Modify node properties]
                          └──required by──> [Remove node]
                          └──required by──> [Attach script to node]

[Create scene]
    └──required by──> [Add node]
                          └──required by──> [Load sprite]

[Read GDScript file]
    └──enhances──> [GDScript diagnostics via LSP]
    └──required by──> [List scripts with structure summary]

[Run project]
    └──required by──> [Get debug output]
    └──required by──> [Runtime scene tree inspection]
    └──required by──> [Screenshot capture]

[Read project.godot settings]
    └──required by──> [Modify project.godot settings]

[Godot LSP running]
    └──required by──> [GDScript diagnostics via LSP]
    └──required by──> [ClassDB introspection]
```

### Dependency Notes

- **SDK compatibility blocks everything:** The known Claude Code tool-discovery bug must be resolved first. No other feature matters until tools appear in Claude Code.
- **Read scene tree gates most scene work:** The AI cannot safely modify what it cannot read. Adding read-before-write is both a UX and correctness improvement.
- **Run project gates all runtime features:** Screenshot, runtime inspection, and debug output all depend on the game actually running.
- **LSP connection enables high-value diagnostics:** GDScript diagnostics and ClassDB introspection via LSP require Godot to be running with LSP enabled (port 6005); these are high-value but require the user to have Godot editor open.

---

## MVP Definition

### Launch With (v1 — immediate milestone)

Minimum viable product to be competitive with the existing ecosystem and fully usable in Claude Code.

- [ ] **SDK upgrade to current** — Without this, zero tools are visible in Claude Code. Blocks everything.
- [ ] **Read scene tree as JSON** — The single most-requested missing feature; every competitor has it.
- [ ] **Modify node properties headlessly** — Required to build scenes iteratively.
- [ ] **Remove node from scene** — Required for scene refactoring.
- [ ] **Attach script to node** — Required to wire up game logic during scene creation.
- [ ] **Read project.godot settings** — Allows AI to understand autoloads, input maps, and rendering config.
- [ ] **Scan for GDScript parse errors** — Low-hanging fruit; uses `godot --check-only --headless`.
- [ ] **Improved error messages** — Every tool should return actionable guidance, not raw Godot stderr.

### Add After Validation (v1.x)

Features to add once core scene workflow is working.

- [ ] **Modify project.godot settings** — Needed for scaffolding; add after read is proven stable.
- [ ] **Create/read resource files (.tres)** — Materials and resources are needed for real game work.
- [ ] **List scripts with structure summary** — Reduces the back-and-forth of "what exists" queries.
- [ ] **MCP resources for current scene/script** — Enables `@godot:scene/current` context references in Claude Code.
- [ ] **GDScript diagnostics via LSP** — High value but requires editor to be open; add as optional enhancement.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **ClassDB introspection** — Reduces hallucination about property names; complex to implement cleanly.
- [ ] **Runtime scene tree inspection** — Requires DAP protocol integration; high complexity.
- [ ] **Screenshot capture** — Useful but requires window management complexity.
- [ ] **Export project headlessly** — CI/CD use case; valuable but niche for MCP workflow.
- [ ] **Tool search / pagination** — Only needed if tool count exceeds ~30; defer until tool count justifies it.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| SDK upgrade (Claude Code compatibility) | HIGH | MEDIUM | P1 |
| Read scene tree as JSON | HIGH | MEDIUM | P1 |
| Modify node properties headlessly | HIGH | MEDIUM | P1 |
| Remove node from scene | HIGH | LOW | P1 |
| Attach script to node | HIGH | LOW | P1 |
| Improved error messages | HIGH | LOW | P1 |
| Read project.godot settings | MEDIUM | LOW | P1 |
| Scan for GDScript parse errors | MEDIUM | LOW | P1 |
| Modify project.godot settings | MEDIUM | MEDIUM | P2 |
| Create resource files (.tres) | MEDIUM | MEDIUM | P2 |
| List scripts with structure summary | MEDIUM | MEDIUM | P2 |
| MCP resources (scene/script as @mentions) | MEDIUM | MEDIUM | P2 |
| GDScript diagnostics via LSP | HIGH | HIGH | P2 |
| ClassDB introspection | HIGH | HIGH | P3 |
| Runtime scene tree inspection | HIGH | HIGH | P3 |
| Screenshot capture | MEDIUM | HIGH | P3 |
| Export project headlessly | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when P1 is stable
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | Coding-Solo (this repo) | tugcantopaloglu (149 tools) | GoPeak / HaD0Yun (95 tools) | ee0pdt | Our Approach |
|---------|------------------------|------------------------------|-----------------------------|--------|--------------|
| Launch editor | Yes | Yes | Yes | Yes | Keep |
| Run / stop / debug output | Yes | Yes | Yes | Yes | Keep; improve output streaming |
| Create scene | Yes | Yes | Yes | Yes | Keep |
| Add node | Yes | Yes | Yes | Yes | Keep |
| Read scene tree | No | Yes (headless JSON) | Yes | Yes | Add — P1 |
| Modify node properties | Partial (add_node properties) | Yes (headless) | Yes | Yes | Expand — P1 |
| Remove node | No | Yes | Yes | Yes | Add — P1 |
| Attach script to node | No | Yes | Yes | Yes | Add — P1 |
| Read project.godot | No | Yes | Partial | No | Add — P1 |
| GDScript diagnostics | No | No | Yes (LSP) | Yes (analyze) | Add — P2 |
| ClassDB introspection | No | No | Yes | No | Consider — P3 |
| Runtime inspection | No | Yes (runtime code exec) | Yes (DAP) | No | Add — P3 |
| MCP resources (@mentions) | No | No | No | Yes | Add — P2 |
| Tool count | 12 | 149 | 95 | ~20 | Target ~30 focused tools |
| Claude Code SDK | v0.6.0 (broken) | Unknown | Unknown | Unknown | Fix immediately — P1 |

---

## Sources

- [Coding-Solo/godot-mcp (this repo)](https://github.com/Coding-Solo/godot-mcp) — current implementation baseline
- [tugcantopaloglu/godot-mcp — 149 tools](https://github.com/tugcantopaloglu/godot-mcp) — comprehensive feature reference
- [GoPeak/HaD0Yun/godot-mcp — 95 tools with LSP+DAP](https://github.com/HaD0Yun/godot-mcp) — most technically sophisticated competitor
- [ee0pdt/Godot-MCP](https://github.com/ee0pdt/Godot-MCP) — GDScript analysis and MCP resources approach
- [bradypp/godot-mcp](https://github.com/bradypp/godot-mcp) — scene CRUD with edit/remove node
- [GDAI MCP Server](https://gdaimcp.com/) — plugin-based with screenshot capture
- [Godot GDScript Diagnostics MCP Server](https://www.pulsemcp.com/servers/ryanmazzolini-godot-gdscript-diagnostics) — LSP-only diagnostics server
- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp) — transport requirements, Tool Search, project scope
- [Godot 4 Command Line Tutorial](https://docs.godotengine.org/en/4.4/tutorials/editor/command_line_tutorial.html) — headless operations reference
- [Godot 4 ClassDB API](https://docs.godotengine.org/en/stable/classes/class_classdb.html) — introspection capabilities
- [MCP Tool Design Best Practices](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers) — tool count and description guidance
- [godot-resource-parser (TypeScript)](https://github.com/fernforestgames/godot-resource-parser) — .tscn/.tres parsing in TypeScript

---

*Feature research for: Godot MCP Server (godot-mcp)*
*Researched: 2026-03-03*
