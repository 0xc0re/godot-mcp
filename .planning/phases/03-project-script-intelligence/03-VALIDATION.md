---
phase: 3
slug: project-script-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | PROJ-01 | unit | `npx vitest run tests/project-parser.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | PROJ-01, PROJ-02 | unit | `npx vitest run tests/project-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | PROJ-03 | unit | `npx vitest run tests/resource-registration.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | SCRI-02, SCRI-04 | unit | `npx vitest run tests/script-tools.test.ts -x` | ✅ (extend) | ⬜ pending |
| 03-XX-XX | XX | 1+ | PROJ-01 | unit | `npx vitest run tests/project-parser.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-XX-XX | XX | 1+ | PROJ-01 | unit | `npx vitest run tests/project-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-XX-XX | XX | 1+ | PROJ-02 | unit | `npx vitest run tests/project-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-XX-XX | XX | 1+ | SCRI-02 | unit | `npx vitest run tests/script-tools.test.ts -x` | ✅ (extend) | ⬜ pending |
| 03-XX-XX | XX | 1+ | SCRI-04 | unit | `npx vitest run tests/script-tools.test.ts -x` | ✅ (extend) | ⬜ pending |
| 03-XX-XX | XX | 1+ | PROJ-03 | unit | `npx vitest run tests/resource-registration.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/project-parser.test.ts` — stubs for PROJ-01 parser logic (sections, multi-line values, autoloads, input maps)
- [ ] `tests/project-tools.test.ts` — stubs for PROJ-01 read tool and PROJ-02 modify tool
- [ ] `tests/resource-registration.test.ts` — stubs for PROJ-03 MCP resource registration
- [ ] `tests/fixtures/sample.project.godot` — realistic project.godot fixture file for parser tests
- [ ] Extend `tests/script-tools.test.ts` — add list_scripts and query_class test cases for SCRI-02, SCRI-04

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| @mention autocomplete for scenes/scripts in Claude Code | PROJ-03 | Requires Claude Code runtime with MCP resource discovery | Start Claude Code, type `@`, verify scene/script resources appear in autocomplete |
| GDScript operations execute in running Godot editor | PROJ-02, SCRI-02, SCRI-04 | Requires Godot editor running with HTTP server addon | Start Godot with project, run modify/list/query tools, verify results |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
