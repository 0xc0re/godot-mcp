---
phase: 8
slug: runtime-inspection-reload
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/runtime-tools.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/runtime-tools.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | RUNT-01 | unit | `npx vitest run tests/runtime-tools.test.ts -t "inspect_scene_tree"` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | RUNT-02 | unit | `npx vitest run tests/runtime-tools.test.ts -t "inspect_node"` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | RUNT-03 | unit | `npx vitest run tests/runtime-tools.test.ts -t "inspect_group"` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | HTRL-01 | unit | `npx vitest run tests/runtime-tools.test.ts -t "restart_project"` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | HTRL-02 | unit | `npx vitest run tests/runtime-tools.test.ts -t "confirms.*running"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/runtime-tools.test.ts` — stubs for RUNT-01, RUNT-02, RUNT-03, HTRL-01, HTRL-02
- [ ] No framework install needed — Vitest already configured

*Existing infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| runtime_helper.gd responds to trigger files in a running Godot game | RUNT-01, RUNT-02, RUNT-03 | Requires a running Godot game with autoload installed | 1. Add runtime_helper.gd as autoload 2. Run project 3. Call inspect_scene_tree 4. Verify JSON response |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
