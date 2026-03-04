---
phase: 7
slug: animation-tilemap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/animation-tools.test.ts tests/tilemap-tools.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/animation-tools.test.ts tests/tilemap-tools.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | ANIM-01 | unit | `npx vitest run tests/animation-tools.test.ts -t "create_animation"` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | ANIM-02 | unit | `npx vitest run tests/animation-tools.test.ts -t "create_animation_library"` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | ANIM-03 | unit | `npx vitest run tests/animation-tools.test.ts -t "add_keyframes"` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | ANIM-04 | unit | `npx vitest run tests/animation-tools.test.ts -t "assign_animation_library"` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | TILE-01 | unit | `npx vitest run tests/tilemap-tools.test.ts -t "create_tileset"` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 1 | TILE-02 | unit | `npx vitest run tests/tilemap-tools.test.ts -t "paint_tilemap"` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 1 | TILE-03 | unit | `npx vitest run tests/tilemap-tools.test.ts -t "fill_tilemap"` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 1 | TILE-04 | unit | `npx vitest run tests/tilemap-tools.test.ts -t "clear_tilemap"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/animation-tools.test.ts` — stubs for ANIM-01, ANIM-02, ANIM-03, ANIM-04
- [ ] `tests/tilemap-tools.test.ts` — stubs for TILE-01, TILE-02, TILE-03, TILE-04

*Existing infrastructure covers framework and fixtures.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
