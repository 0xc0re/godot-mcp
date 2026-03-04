---
phase: 4
slug: diagnostics-runtime
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | SCRI-03 | unit | `npx vitest run tests/lsp-protocol.test.ts -x` | W0 | pending |
| 04-02-01 | 02 | 1 | RUNT-01 | unit | `npx vitest run tests/screenshot-tools.test.ts -x` | W0 | pending |
| 04-03-01 | 03 | 2 | SCRI-03 | unit | `npx vitest run tests/lsp-client.test.ts -x` | W0 | pending |
| 04-03-02 | 03 | 2 | SCRI-03 | unit | `npx vitest run tests/diagnostics-tools.test.ts -x` | W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/lsp-protocol.test.ts` — stubs for SCRI-03 message framing encode/decode
- [ ] `tests/lsp-client.test.ts` — stubs for SCRI-03 LSP connection and initialization
- [ ] `tests/diagnostics-tools.test.ts` — stubs for SCRI-03 MCP tool registration and handler
- [ ] `tests/screenshot-tools.test.ts` — stubs for RUNT-01 MCP tool registration and image response

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Screenshot captures correct viewport | RUNT-01 | Requires running Godot game with visible rendering | Launch game, trigger capture, visually verify PNG |
| LSP connection to live Godot editor | SCRI-03 | Requires running Godot editor instance | Start editor, connect LSP client, verify diagnostics received |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
