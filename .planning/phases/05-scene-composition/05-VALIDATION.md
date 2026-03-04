---
phase: 5
slug: scene-composition
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/composition-tools.test.ts tests/tscn-parser.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/composition-tools.test.ts tests/tscn-parser.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | COMP-01 | unit | `npx vitest run tests/composition-tools.test.ts -t "connect_signal"` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | COMP-02 | unit | `npx vitest run tests/composition-tools.test.ts -t "disconnect_signal"` | ❌ W0 | ⬜ pending |
| 5-01-03 | 01 | 1 | COMP-03 | unit | `npx vitest run tests/composition-tools.test.ts -t "instance_scene"` | ❌ W0 | ⬜ pending |
| 5-01-04 | 01 | 1 | COMP-04 | unit | `npx vitest run tests/composition-tools.test.ts -t "batch_set_properties"` | ❌ W0 | ⬜ pending |
| 5-01-05 | 01 | 1 | COMP-05 | unit | `npx vitest run tests/composition-tools.test.ts -t "manage_groups" -t "add"` | ❌ W0 | ⬜ pending |
| 5-01-06 | 01 | 1 | COMP-06 | unit | `npx vitest run tests/composition-tools.test.ts -t "manage_groups" -t "remove"` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 1 | PARSER | unit | `npx vitest run tests/tscn-parser.test.ts -t "groups"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/composition-tools.test.ts` — stubs for COMP-01 through COMP-06 (tool handler tests)
- [ ] Additional tests in `tests/tscn-parser.test.ts` — covers groups parsing enhancement
- [ ] `tests/fixtures/sample-with-groups.tscn` — fixture with groups and connections for parser tests

*Existing infrastructure covers framework setup (vitest already configured).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scene instancing produces `instance=ExtResource(...)` not inlined nodes | COMP-03 | Requires running headless Godot against a real project | Create test scene, run instance_scene tool, verify .tscn file contains `instance=ExtResource(...)` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
