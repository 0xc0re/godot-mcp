---
phase: 2
slug: scene-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | SCEN-01 | unit | `npx vitest run tests/tscn-parser.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | SCEN-06 | unit | `npx vitest run tests/tscn-parser.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | SCEN-02 | unit | `npx vitest run tests/scene-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | SCEN-03 | unit | `npx vitest run tests/scene-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | SCEN-04 | unit | `npx vitest run tests/scene-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 1 | SCEN-05 | unit | `npx vitest run tests/resource-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 1 | SCRI-01 | unit | `npx vitest run tests/script-tools.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tscn-parser.test.ts` — parser unit tests for SCEN-01, SCEN-06 with sample .tscn/.tres content
- [ ] `tests/scene-tools.test.ts` — tool registration and parameter validation for SCEN-02, SCEN-03, SCEN-04
- [ ] `tests/resource-tools.test.ts` — resource tool registration for SCEN-05
- [ ] `tests/script-tools.test.ts` — validate_scripts tool for SCRI-01
- [ ] `tests/fixtures/sample.tscn` — sample .tscn file for parser tests
- [ ] `tests/fixtures/sample.tres` — sample .tres file for parser tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Godot headless write roundtrip | SCEN-02, SCEN-03, SCEN-04, SCEN-05 | Requires actual Godot binary | Open modified .tscn in Godot editor, verify changes persisted |
| Batch GDScript validation accuracy | SCRI-01 | Requires real .gd files with parse errors | Create intentionally broken .gd files, run validate_scripts, verify error reporting |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
