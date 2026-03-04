---
phase: 6
slug: project-configuration-assets
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | CONF-01 | unit | `npx vitest run tests/config-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | CONF-02 | unit | `npx vitest run tests/config-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | CONF-03 | unit | `npx vitest run tests/config-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | CONF-04 | unit | `npx vitest run tests/config-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | SHDR-01 | unit | `npx vitest run tests/shader-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | SHDR-02 | unit | `npx vitest run tests/shader-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 1 | SHDR-03 | unit | `npx vitest run tests/shader-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 2 | EXPT-01 | unit | `npx vitest run tests/export-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 2 | EXPT-02 | unit | `npx vitest run tests/export-tools.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-03-03 | 03 | 2 | EXPT-03 | unit | `npx vitest run tests/export-tools.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/config-tools.test.ts` — stubs for CONF-01 through CONF-04
- [ ] `tests/shader-tools.test.ts` — stubs for SHDR-01 through SHDR-03
- [ ] `tests/export-tools.test.ts` — stubs for EXPT-01 through EXPT-03
- [ ] `tests/fixtures/sample.export_presets.cfg` — fixture for export preset parsing tests

*Existing infrastructure covers framework needs — vitest.config.ts and vitest are installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Input action persists after Godot reload | CONF-01 | Requires Godot runtime to verify persistence | 1. Add input action via MCP 2. Reload project 3. Verify action exists in Input Map |
| Export produces runnable binary | EXPT-01 | Requires platform-specific binary execution | 1. Export via MCP 2. Verify output file exists and has non-zero size |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
