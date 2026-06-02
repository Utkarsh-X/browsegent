# Canonical Projection Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce BrowseGent planner-input payload size by removing structural duplication across projection views without dropping refs, truncating text, summarizing evidence, or adding benchmark-specific behavior.

**Architecture:** `serializeProjection` will emit one canonical `refs` map containing full serialized ref facts and keep `interactions`, `readables`, and `navigation` as ranked lightweight views of `refId`s. Planner validation will collect allowed refs from the canonical map plus regions/focus, preserving existing ref legality while reducing duplicated serialized facts.

**Tech Stack:** TypeScript, Node test runner, BrowseGent v2 planner/projection types, existing benchmark diagnostics.

---

### Task 1: Canonical Projection Shape Tests

**Files:**
- Modify: `tests/unit/v2/brain1Projection.test.ts`
- Modify: `src/v2/brain1/projectionTypes.ts`
- Modify: `src/v2/brain1/serializeProjection.ts`

- [ ] **Step 1: Add failing tests for canonical refs and lightweight views**

Add tests proving:
- full ref facts are stored once in `serialized.refs`
- `interactions`, `readables`, and `navigation` carry ranked `refId` view entries
- a ref appearing in multiple views is not serialized as a full item multiple times
- duplicate `text` matching `name` is still omitted inside the canonical ref fact

- [ ] **Step 2: Run targeted test and confirm RED**

Run: `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/brain1Projection.test.ts`

Expected: fails because `serialized.refs` does not exist yet.

- [ ] **Step 3: Implement minimal canonical projection serialization**

Update projection types and serializer only. Do not add caps, summarization, ranking changes, or task/domain logic.

- [ ] **Step 4: Run targeted test and confirm GREEN**

Run: `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/brain1Projection.test.ts`

Expected: all tests in the file pass.

### Task 2: Planner Validation And Prompt Contract Tests

**Files:**
- Modify: `tests/unit/v2/v2PlannerClient.test.ts`
- Modify: `tests/unit/v2/plannerInputComposer.test.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Modify: `src/v2/planner/PlannerPrompt.ts`

- [ ] **Step 1: Add failing tests for canonical validation context**

Add tests proving:
- planner validation accepts refs present only in `current.refs`
- validation no longer depends on full items being repeated inside view arrays
- the planner prompt explains that `current.refs` contains full facts and view arrays are ranked ref lists

- [ ] **Step 2: Run targeted planner tests and confirm RED**

Run: `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/plannerInputComposer.test.ts`

Expected: fails until validation context and prompt contract are updated.

- [ ] **Step 3: Update planner validation and prompt**

Collect allowed refs from `input.current.refs`, region refs, focus, and view `refId`s. Add one concise prompt sentence explaining the canonical shape.

- [ ] **Step 4: Run targeted planner tests and confirm GREEN**

Run: `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/plannerInputComposer.test.ts`

Expected: all targeted planner tests pass.

### Task 3: Diagnostics Compatibility

**Files:**
- Modify: `tests/unit/v2/benchmarkDiagnostics.test.ts`
- Modify: `tests/benchmark/v2/diagnostics.ts`
- Modify: `docs/evaluation/root-cause-matrix.md`

- [ ] **Step 1: Add failing diagnostic test for canonical shape**

Add or update a diagnostic fixture where `current.refs` stores full facts and view arrays contain lightweight ref entries. Assert overlap diagnostics and section-size diagnostics still work.

- [ ] **Step 2: Run targeted diagnostics test and confirm RED if current logic misses the new shape**

Run: `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/benchmarkDiagnostics.test.ts`

Expected: fails only if diagnostics cannot read the new shape; if it passes already, document why no production change is needed.

- [ ] **Step 3: Update diagnostics only if needed**

Keep diagnostics shape-aware but non-mutating. Do not add benchmark scoring logic.

- [ ] **Step 4: Update root-cause matrix**

Document that canonical projection serialization is the first architectural payload fix and that caps/summarization remain out of scope.

### Task 4: Verification

**Files:**
- No additional files expected.

- [ ] **Step 1: Run targeted tests**

Run:
- `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/brain1Projection.test.ts`
- `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/plannerInputComposer.test.ts`
- `.\node_modules\.bin\tsx.cmd --test tests/unit/v2/benchmarkDiagnostics.test.ts`

- [ ] **Step 2: Run full verification**

Run:
- `npm.cmd run test:unit`
- `.\node_modules\.bin\tsc.cmd --noEmit`
- `npm.cmd run check:v2`
- `git diff --check`
- Run the standard secret-pattern scan over `docs tests src .env.example .gitignore` without adding key material to the repo.

- [ ] **Step 3: Report status**

Report exact verification evidence, remaining risks, and whether the 5-task benchmark is now the next appropriate check. Do not mark the long-term goal complete unless the full objective is verified.
