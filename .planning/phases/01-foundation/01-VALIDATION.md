---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-03
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (to be installed in Wave 0) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && grep -r "console.log" src/ && test $(wc -l < src/index.ts) -lt 100`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | FOUN-01 | unit | `npx vitest run tests/sdk-version.test.ts -t "sdk version"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | FOUN-02 | unit | `npx vitest run tests/tool-registration.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 0 | FOUN-03 | unit | `npx vitest run tests/sdk-version.test.ts -t "zod"` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 0 | FOUN-04 | unit | `npx vitest run tests/process-hardening.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 0 | FOUN-05 | unit | `npx vitest run tests/error-responses.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 0 | FOUN-06 | smoke | `wc -l src/index.ts && ls src/tools/` | ❌ W0 | ⬜ pending |
| 1-01-07 | 01 | 0 | FOUN-07 | smoke | `grep -r "console.log" src/ && echo FAIL \|\| echo PASS` | ❌ W0 | ⬜ pending |
| 1-01-08 | 01 | 0 | FOUN-08 | unit | `npx vitest run tests/signal-handlers.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` — install as devDependency: `npm install -D vitest`
- [ ] `vitest.config.ts` — basic config for TypeScript ESM project
- [ ] `tests/tool-registration.test.ts` — verify all 14 tools register on McpServer
- [ ] `tests/sdk-version.test.ts` — verify SDK version and Zod version
- [ ] `tests/process-hardening.test.ts` — verify maxBuffer/timeout on exec calls
- [ ] `tests/error-responses.test.ts` — verify error structure
- [ ] `tests/signal-handlers.test.ts` — verify SIGINT/SIGTERM handlers exist

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Claude Code connects and lists tools | FOUN-02 | Requires running Claude Code client | Start server, connect Claude Code, run `/tools` |
| No zombie Godot processes after SIGTERM | FOUN-08 | Requires real Godot process | Start server, launch editor, send SIGTERM, check `ps aux \| grep godot` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
