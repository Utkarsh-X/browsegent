# Phase A2 Ref Resolution Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce planner-loop waste by moving ref-resolution diagnostics, conservative self-healing, and ambiguity handling into the runtime control plane.

**Architecture:** Preserve the existing planner API and planner prompt. Add structured diagnostics and trace artifacts around ref execution failures, then introduce one conservative self-heal path for weakened refs that can still be verified by the Playwright-backed `RefResolver`.

**Tech Stack:** TypeScript, Node test runner, BrowseGent V2 runtime, `RefService`, `RefResolver`, `BrowseGentV2Harness`, `TraceStore`, existing benchmark trace artifacts.

---

## Context From Phase A1

Phase A1 succeeded as telemetry, not as behavior change:

- Average compact/current ratio: `0.1353`, comfortably under the `0.35` target.
- Plain interactive baseline/current ratio: `0.1205`, slightly smaller than graph-derived compact view.
- Average action-ref coverage: `0.9015`, below the `0.95` gate.
- Missing planned action refs: `6`.

This means compact view should not be enforced yet. A2 should improve the runtime substrate first, because missing refs and ref-resolution failures contaminate planner behavior and compact-view coverage.

## Non-Negotiable Scope Rules

- Do not change `D:\BrowseGent\src\v2\planner\PlannerPrompt.ts`.
- Do not change `D:\BrowseGent\src\v2\planner\V2PlannerClient.ts`.
- Do not make the planner consume compact view.
- Do not add site-specific WebVoyager logic.
- Do not change benchmark scoring.
- Do not silently self-heal unsafe actions.
- Do not implement Phase A3 shadow planner or Phase A4 compact enforcement.
- Do not touch or commit API key files, `new-keys.yaml`, `debug.log`, or benchmark logs.

## A2 Design Boundary

A2 should do three things only:

1. Preserve and trace ref-resolution diagnostics.
2. Build structured ref-resolution audits for failed or self-healed targets.
3. Allow a weakened ref to execute only when runtime verification succeeds through the existing `RefResolver`.

It should not ask the planner to guess alternate refs.

---

## File Map

- Modify `D:\BrowseGent\src\v2\runtime\types.ts`
  - Add optional diagnostics to `V2ToolError`.
- Modify `D:\BrowseGent\src\v2\runtime\FailureClassifier.ts`
  - Preserve diagnostics in `FailureEvidence`.
- Modify `D:\BrowseGent\tests\unit\v2\failureClassifier.test.ts`
  - Verify diagnostics survive classification.
- Create `D:\BrowseGent\src\v2\runtime\RefResolutionAudit.ts`
  - Build deterministic, JSON-safe audit records from observation/ref/error context.
- Create `D:\BrowseGent\tests\unit\v2\refResolutionAudit.test.ts`
  - Unit tests for ambiguous, stale/missing, weakened, and blocked target audits.
- Create `D:\BrowseGent\src\v2\runtime\RefSelfHealingPolicy.ts`
  - Decide whether a weakened ref can be passed to `InputService`/read execution for runtime verification.
- Create `D:\BrowseGent\tests\unit\v2\refSelfHealingPolicy.test.ts`
  - Unit tests for allowed and denied weakened-ref self-heal decisions.
- Modify `D:\BrowseGent\src\v2\trace\types.ts`
  - Add `ref_resolution_audit` artifact kind and manifest array.
- Modify `D:\BrowseGent\src\v2\trace\TraceStore.ts`
  - Add `recordRefResolutionAudit()`.
- Modify `D:\BrowseGent\tests\unit\v2\traceStore.test.ts`
  - Verify ref-resolution audit artifacts are written.
- Modify `D:\BrowseGent\src\v2\substrate\RefResolver.ts`
  - Preserve structured candidate diagnostics and add a safe `nthRoleName` tie-breaker.
- Modify `D:\BrowseGent\tests\unit\v2\refResolver.test.ts`
  - Verify diagnostics and safe tie-break behavior.
- Modify `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`
  - Record audits, propagate diagnostics, and apply conservative weakened-ref self-heal.
- Modify `D:\BrowseGent\tests\unit\v2\refService.test.ts`
  - Keep current conservative ref identity behavior covered.
- Modify `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`
  - Verify failure diagnostics reach planner recovery through `lastResult.error.diagnostics`.
- Create `D:\BrowseGent\tests\benchmark\v2\ref_resolution_audit_summary.ts`
  - Summarize ref-resolution audit artifacts from benchmark traces.

---

## Task 1: Preserve Error Diagnostics Through Runtime And Failure Evidence

**Files:**
- Modify: `D:\BrowseGent\src\v2\runtime\types.ts`
- Modify: `D:\BrowseGent\src\v2\runtime\FailureClassifier.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\failureClassifier.test.ts`

- [ ] **Step 1: Write failing diagnostics preservation test**

Append this test to `D:\BrowseGent\tests\unit\v2\failureClassifier.test.ts`:

```ts
test('FailureClassifier preserves structured runtime diagnostics', () => {
  const result: V2ToolResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_search',
    error: {
      code: 'ambiguous_ref_resolution',
      message: 'Ref resolved to multiple equivalent candidates.',
      retryable: false,
      diagnostics: {
        reason: 'tied_candidates',
        candidateCount: 2,
        topScore: 135,
      },
    },
    traceStepId: 'step_ambiguous',
  };

  const evidence = new FailureClassifier().classify(result, {
    observationId: 'obs_ambiguous',
  });

  assert.equal(evidence.kind, 'ambiguous_ref_resolution');
  assert.deepEqual(evidence.diagnostics, {
    reason: 'tied_candidates',
    candidateCount: 2,
    topScore: 135,
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/failureClassifier.test.ts
```

Expected: fails because `V2ToolError` and `FailureEvidence` do not expose `diagnostics`.

- [ ] **Step 3: Add diagnostics to runtime tool errors**

In `D:\BrowseGent\src\v2\runtime\types.ts`, change `V2ToolError` to:

```ts
export interface V2ToolError {
  code: string;
  message: string;
  retryable: boolean;
  diagnostics?: Record<string, unknown>;
}
```

- [ ] **Step 4: Add diagnostics to failure evidence**

In `D:\BrowseGent\src\v2\runtime\FailureClassifier.ts`, add this optional field to `FailureEvidence`:

```ts
diagnostics?: Record<string, unknown>;
```

Update `createFailureEvidence()` input type to accept:

```ts
diagnostics?: Record<string, unknown>;
```

In `FailureClassifier.classify()`, pass diagnostics from the extracted error:

```ts
diagnostics: error?.diagnostics,
```

In `createFailureEvidence()`, include diagnostics only when present:

```ts
...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
```

- [ ] **Step 5: Run focused test**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/failureClassifier.test.ts
```

Expected: pass.

---

## Task 2: Add Ref Resolution Audit Builder

**Files:**
- Create: `D:\BrowseGent\src\v2\runtime\RefResolutionAudit.ts`
- Create: `D:\BrowseGent\tests\unit\v2\refResolutionAudit.test.ts`

- [ ] **Step 1: Create failing audit tests**

Create `D:\BrowseGent\tests\unit\v2\refResolutionAudit.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRefResolutionAudit } from '../../../src/v2/runtime/RefResolutionAudit';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_submit',
    generationId: 1,
    targetId: 'target_submit',
    selectorCandidates: ['#submit'],
    role: 'button',
    name: 'Submit',
    text: 'Submit',
    tagName: 'button',
    nthRoleName: 1,
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
    ...overrides,
  };
}

function makeObservation(refs: V2Ref[]): BrowserObservation {
  return buildBrowserObservation({
    observationId: 'obs_audit',
    sessionId: 'session_audit',
    generationId: 1,
    url: 'https://example.test',
    title: 'Audit Fixture',
    timestamp: 1,
    durationMs: 1,
    refs,
    warnings: [],
  });
}

test('buildRefResolutionAudit explains ambiguous same role/name candidates', () => {
  const observation = makeObservation([
    makeRef({ refId: 'ref_submit_1', targetId: 'target_1', nthRoleName: 1 }),
    makeRef({ refId: 'ref_submit_2', targetId: 'target_2', nthRoleName: 2 }),
  ]);

  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit_1',
    actionKind: 'click',
    failureCode: 'ambiguous_ref_resolution',
    diagnostics: { reason: 'tied_candidates', candidateCount: 2 },
  });

  assert.equal(audit.version, 'ref_resolution_audit.v1');
  assert.equal(audit.targetRef, 'ref_submit_1');
  assert.equal(audit.summary.sameRoleNameCandidates, 2);
  assert.equal(audit.summary.reason, 'ambiguous_same_role_name');
  assert.equal(audit.candidates.length, 2);
  assert.equal(audit.candidates[0].refId, 'ref_submit_1');
});

test('buildRefResolutionAudit explains missing target refs', () => {
  const observation = makeObservation([makeRef({ refId: 'ref_other', name: 'Other', text: 'Other' })]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_missing',
    actionKind: 'click',
    failureCode: 'stale_ref',
  });

  assert.equal(audit.summary.reason, 'target_ref_not_in_observation');
  assert.equal(audit.target, undefined);
  assert.equal(audit.candidates.length, 0);
});

test('buildRefResolutionAudit records weakened target state', () => {
  const observation = makeObservation([
    makeRef({ state: 'weakened', continuityConfidence: 0.55, invalidationReason: 'soft_identity_match_requires_verification' }),
  ]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit',
    actionKind: 'click',
    failureCode: 'low_confidence_ref',
  });

  assert.equal(audit.summary.reason, 'target_ref_weakened');
  assert.equal(audit.target?.state, 'weakened');
  assert.equal(audit.target?.continuityConfidence, 0.55);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/refResolutionAudit.test.ts
```

Expected: fails because `RefResolutionAudit.ts` does not exist.

- [ ] **Step 3: Implement audit builder**

Create `D:\BrowseGent\src\v2\runtime\RefResolutionAudit.ts`:

```ts
import type { BrowserObservation, RefState, V2Ref } from './types';

export interface RefResolutionAuditInput {
  observation: BrowserObservation;
  targetRef: string;
  actionKind: string;
  failureCode?: string;
  diagnostics?: Record<string, unknown>;
  selfHeal?: {
    attempted: boolean;
    result: 'not_attempted' | 'succeeded' | 'failed';
    reason: string;
  };
}

export interface RefResolutionAudit {
  version: 'ref_resolution_audit.v1';
  auditId: string;
  observationId: string;
  generationId: number;
  url: string;
  actionKind: string;
  targetRef: string;
  failureCode?: string;
  diagnostics?: Record<string, unknown>;
  target?: RefAuditTarget;
  candidates: RefAuditCandidate[];
  summary: {
    reason: string;
    candidateCount: number;
    sameRoleNameCandidates: number;
    visibleReadyCandidates: number;
  };
  selfHeal?: RefResolutionAuditInput['selfHeal'];
}

export interface RefAuditTarget {
  refId: string;
  role?: string;
  name?: string;
  text?: string;
  targetId: string;
  state: RefState;
  visibility: string;
  actionability: string;
  continuityConfidence: number;
  nthRoleName?: number;
}

export interface RefAuditCandidate extends RefAuditTarget {
  score: number;
  sameRole: boolean;
  sameName: boolean;
  sameText: boolean;
  sameTargetId: boolean;
  sameNthRoleName: boolean;
}
```

Implement `buildRefResolutionAudit(input)` with these rules:

- `target` is the current observation ref with `refId === targetRef`, if present.
- Candidate refs are refs that match the target by role, name, text, targetId, or `nthRoleName`.
- If target is absent, candidates should be empty and reason should be `target_ref_not_in_observation`.
- If target state is `weakened`, reason should be `target_ref_weakened`.
- If two or more candidates share target role and name, reason should be `ambiguous_same_role_name`.
- If target actionability is `blocked`, reason should be `target_blocked`.
- Otherwise reason should be `runtime_resolution_failure`.
- Candidate `score` should be deterministic:
  - `+40` same targetId,
  - `+20` same role,
  - `+20` same name,
  - `+10` same text,
  - `+10` same nthRoleName,
  - `+5` visible,
  - `+5` ready.
- Sort candidates by score descending, then `refId` ascending.
- Keep at most 10 candidates.

- [ ] **Step 4: Run audit tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/refResolutionAudit.test.ts
```

Expected: pass.

---

## Task 3: Add Conservative Self-Healing Policy

**Files:**
- Create: `D:\BrowseGent\src\v2\runtime\RefSelfHealingPolicy.ts`
- Create: `D:\BrowseGent\tests\unit\v2\refSelfHealingPolicy.test.ts`

- [ ] **Step 1: Create failing policy tests**

Create `D:\BrowseGent\tests\unit\v2\refSelfHealingPolicy.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAttemptWeakenedRefSelfHeal } from '../../../src/v2/runtime/RefSelfHealingPolicy';
import type { V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_query',
    generationId: 2,
    targetId: 'target_query',
    selectorCandidates: ['input[name="q"]'],
    role: 'textbox',
    name: 'Search',
    tagName: 'input',
    inputType: 'search',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 0.55,
    state: 'weakened',
    capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
    invalidationReason: 'soft_identity_match_requires_verification',
    ...overrides,
  };
}

test('shouldAttemptWeakenedRefSelfHeal allows visible ready typeable weakened refs', () => {
  const decision = shouldAttemptWeakenedRefSelfHeal('type', makeRef());
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'verified_runtime_resolution_required');
});

test('shouldAttemptWeakenedRefSelfHeal denies low-confidence weakened refs', () => {
  const decision = shouldAttemptWeakenedRefSelfHeal('type', makeRef({ continuityConfidence: 0.3 }));
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'continuity_confidence_too_low');
});

test('shouldAttemptWeakenedRefSelfHeal denies incompatible actions', () => {
  const decision = shouldAttemptWeakenedRefSelfHeal('type', makeRef({
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
  }));
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'action_not_compatible');
});

test('shouldAttemptWeakenedRefSelfHeal denies hidden or blocked refs', () => {
  assert.equal(shouldAttemptWeakenedRefSelfHeal('click', makeRef({ visibility: 'hidden' })).allow, false);
  assert.equal(shouldAttemptWeakenedRefSelfHeal('click', makeRef({ actionability: 'blocked' })).allow, false);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/refSelfHealingPolicy.test.ts
```

Expected: fails because `RefSelfHealingPolicy.ts` does not exist.

- [ ] **Step 3: Implement policy**

Create `D:\BrowseGent\src\v2\runtime\RefSelfHealingPolicy.ts`:

```ts
import type { V2Ref } from './types';

export interface RefSelfHealDecision {
  allow: boolean;
  reason:
    | 'verified_runtime_resolution_required'
    | 'ref_not_weakened'
    | 'continuity_confidence_too_low'
    | 'target_not_visible_ready'
    | 'action_not_compatible'
    | 'missing_selector_candidates';
}

export function shouldAttemptWeakenedRefSelfHeal(actionKind: string, ref: V2Ref | undefined): RefSelfHealDecision {
  if (!ref || ref.state !== 'weakened') {
    return { allow: false, reason: 'ref_not_weakened' };
  }
  if (ref.continuityConfidence < 0.5) {
    return { allow: false, reason: 'continuity_confidence_too_low' };
  }
  if (ref.visibility !== 'visible' || ref.actionability !== 'ready') {
    return { allow: false, reason: 'target_not_visible_ready' };
  }
  if (ref.selectorCandidates.length === 0) {
    return { allow: false, reason: 'missing_selector_candidates' };
  }

  const caps = ref.capabilities;
  if (actionKind === 'click' && caps?.clickable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }
  if (actionKind === 'type' && caps?.typeable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }
  if (actionKind === 'select' && caps?.selectable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }
  if ((actionKind === 'get' || actionKind === 'inspect_region') && caps?.readable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }

  return { allow: true, reason: 'verified_runtime_resolution_required' };
}
```

- [ ] **Step 4: Run policy tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/refSelfHealingPolicy.test.ts
```

Expected: pass.

---

## Task 4: Add Ref Resolution Audit Trace Artifacts

**Files:**
- Modify: `D:\BrowseGent\src\v2\trace\types.ts`
- Modify: `D:\BrowseGent\src\v2\trace\TraceStore.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\traceStore.test.ts`

- [ ] **Step 1: Write failing trace test**

Append this test to `D:\BrowseGent\tests\unit\v2\traceStore.test.ts`:

```ts
test('TraceStore writes ref resolution audit artifacts and manifest entries', async () => {
  const traceDir = await freshTraceDir('ref_resolution_audit');
  const store = new TraceStore({
    runId: 'run_trace_ref_audit',
    runtimeMode: 'agent',
    traceDir,
    startTime: 6666,
  });

  const payload = {
    version: 'ref_resolution_audit.v1',
    auditId: 'audit_obs_1_ref_submit_click',
    observationId: 'obs_1',
    generationId: 1,
    url: 'https://example.test',
    actionKind: 'click',
    targetRef: 'ref_submit',
    summary: {
      reason: 'ambiguous_same_role_name',
      candidateCount: 2,
      sameRoleNameCandidates: 2,
      visibleReadyCandidates: 2,
    },
    candidates: [],
  };

  const artifact = store.recordRefResolutionAudit(payload.auditId, payload);
  const manifest = await store.flush();

  assert.equal(artifact.kind, 'ref_resolution_audit');
  assert.equal(manifest.artifacts.refResolutionAudits?.length, 1);
  assert.equal(manifest.artifacts.refResolutionAudits?.[0].id, payload.auditId);
});
```

- [ ] **Step 2: Run trace tests and verify failure**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/traceStore.test.ts
```

Expected: fails because trace support does not exist yet.

- [ ] **Step 3: Update trace types**

In `D:\BrowseGent\src\v2\trace\types.ts`:

- Add `'ref_resolution_audit'` to `TraceArtifactKind`.
- Add this optional manifest field:

```ts
refResolutionAudits?: TraceArtifact[];
```

- [ ] **Step 4: Update TraceStore**

In `D:\BrowseGent\src\v2\trace\TraceStore.ts`:

- Add:

```ts
private readonly refResolutionAudits = new Map<string, TracePlannerRecord>();
```

- Add method:

```ts
recordRefResolutionAudit(auditId: string, payload: unknown): TraceArtifact {
  const artifact = this.createArtifact('ref_resolution_audit', auditId, 'ref-resolution', `${auditId}.json`);
  this.refResolutionAudits.set(auditId, {
    artifact,
    payload: toTraceJsonValue(payload),
  });
  return artifact;
}
```

- In `flush()`, create:

```ts
await mkdir(join(runRoot, 'ref-resolution'), { recursive: true });
```

- In `flush()`, write:

```ts
for (const record of this.refResolutionAudits.values()) {
  await writeFile(record.artifact.path, stringifyTraceJson(record.payload), 'utf8');
}
```

- In `createManifest()`, add:

```ts
refResolutionAudits: [...this.refResolutionAudits.values()].map((record) => record.artifact),
```

- [ ] **Step 5: Run trace tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/traceStore.test.ts
```

Expected: pass.

---

## Task 5: Improve RefResolver Diagnostics And Safe Tie-Breaking

**Files:**
- Modify: `D:\BrowseGent\src\v2\substrate\RefResolver.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\refResolver.test.ts`

- [ ] **Step 1: Add failing tie-break test**

Append this test to `D:\BrowseGent\tests\unit\v2\refResolver.test.ts`:

```ts
test('RefResolver uses nthRoleName as a safe semantic tie breaker', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => ({
        evaluate: async (_fn: unknown, expected: { nthRoleName?: number }) => ({
          score: expected.nthRoleName === index + 1 ? 132 : 120,
          identityKey: `button|${index}|submit`,
          diagnostics: {
            nthRoleNameMatched: expected.nthRoleName === index + 1,
          },
        }),
      }),
    }),
  } as never;

  const result = await resolver.resolve(makeRef({
    selectorCandidates: ['button'],
    nthRoleName: 2,
  }), fakePage);

  assert.equal(result.resolution, 'unique_selector');
  assert.equal(result.diagnostics?.topScore, 132);
  assert.equal(result.diagnostics?.reason, 'resolved_unique_top_candidate');
});
```

Append this assertion to the existing ambiguous test:

```ts
assert.equal(Array.isArray(err.diagnostics?.topCandidates), true);
```

- [ ] **Step 2: Run resolver tests and verify failure**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/refResolver.test.ts
```

Expected: fails because `ResolvedRefTarget` has no diagnostics and `scoreCandidate` does not pass `nthRoleName`.

- [ ] **Step 3: Extend resolver result type**

In `D:\BrowseGent\src\v2\substrate\RefResolver.ts`, update:

```ts
export interface ResolvedRefTarget {
  locator: Locator;
  resolution: 'unique_selector' | 'semantic_selector';
  diagnostics?: Record<string, unknown>;
}
```

- [ ] **Step 4: Extend scored candidates**

Update `ScoredCandidate`:

```ts
interface ScoredCandidate {
  locator: Locator;
  score: number;
  identityKey: string;
  diagnostics?: Record<string, unknown>;
}
```

Update `scoreCandidate()` to return:

```ts
Promise<{ score: number; identityKey: string; diagnostics?: Record<string, unknown> }>
```

Pass `nthRoleName` into `locator.evaluate()`:

```ts
nthRoleName: ref.nthRoleName,
```

Inside the browser-side scoring function:

- compute role/name as it already does,
- compute `roleNameOrdinal` among visible elements with the same role and accessible name/text,
- if `expected.nthRoleName` equals that ordinal, add `12` to score,
- return diagnostics:

```ts
diagnostics: {
  tagName,
  role,
  nameMatched: Boolean(name && (ariaLabel === name || text === name)),
  textMatched: Boolean(expectedText && text === expectedText),
  nthRoleNameMatched: expected.nthRoleName === roleNameOrdinal,
  roleNameOrdinal,
}
```

- [ ] **Step 5: Include top candidate diagnostics in thrown errors**

When throwing `stale_ref` or `ambiguous_ref_resolution`, include:

```ts
topCandidates: sorted.slice(0, 5).map(candidate => ({
  score: candidate.score,
  identityKey: candidate.identityKey,
  diagnostics: candidate.diagnostics,
})),
```

When returning success, include:

```ts
diagnostics: {
  reason: 'resolved_unique_top_candidate',
  candidateCount: sorted.length,
  topScore: sorted[0].score,
  topIdentityKey: sorted[0].identityKey,
}
```

- [ ] **Step 6: Run resolver tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/refResolver.test.ts
```

Expected: pass.

---

## Task 6: Integrate Audits And Conservative Self-Heal In Harness

**Files:**
- Modify: `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`

- [ ] **Step 1: Add diagnostics assertion to V2AgentLoop failure test**

In `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`, find the test named:

```ts
V2AgentLoop feeds failed runtime evidence into the next planner input
```

Add `diagnostics` to the fake failed result error:

```ts
diagnostics: {
  reason: 'target_blocked_by_overlay',
  candidateCount: 1,
},
```

Add these assertions after the existing `lastResult.error.code` assertion:

```ts
assert.deepEqual(planner.inputs[1].lastResult?.error?.diagnostics, {
  reason: 'target_blocked_by_overlay',
  candidateCount: 1,
});
assert.deepEqual(harness.failures[0].diagnostics, {
  reason: 'target_blocked_by_overlay',
  candidateCount: 1,
});
```

- [ ] **Step 2: Run V2AgentLoop test and verify failure**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/v2AgentLoop.test.ts
```

Expected: fails until diagnostics are preserved by earlier tasks and planner summary types allow diagnostics.

- [ ] **Step 3: Add diagnostics to planner last-result summary**

In `D:\BrowseGent\src\v2\planner\types.ts`, update `PlannerLastResultSummary.error`:

```ts
error?: {
  code: string;
  retryable: boolean;
  diagnostics?: Record<string, unknown>;
};
```

In `D:\BrowseGent\src\v2\planner\PlannerInputComposer.ts`, include diagnostics:

```ts
diagnostics: result.error.diagnostics,
```

Only include the property when present if TypeScript complains about exact optional property types.

- [ ] **Step 4: Import audit and policy helpers in harness**

At the top of `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`, add:

```ts
import { buildRefResolutionAudit } from '../runtime/RefResolutionAudit';
import { shouldAttemptWeakenedRefSelfHeal } from '../runtime/RefSelfHealingPolicy';
```

- [ ] **Step 5: Preserve V2OperationalError diagnostics**

Update `mapExecutionError()` in `BrowseGentV2Harness.ts`.

For `V2OperationalError`, return:

```ts
return {
  code: error.code,
  message: error.message,
  retryable: error.retryable,
  diagnostics: error.diagnostics,
};
```

Update `mapResolutionError()` to accept an optional diagnostics object:

```ts
function mapResolutionError(state: string, diagnostics?: Record<string, unknown>): V2ToolError
```

and include diagnostics in returned errors.

- [ ] **Step 6: Add audit recording helper in harness**

Inside `BrowseGentV2Harness`, add private method:

```ts
private recordRefResolutionAudit(input: {
  observation: BrowserObservation;
  targetRef: string;
  actionKind: string;
  failureCode?: string;
  diagnostics?: Record<string, unknown>;
  selfHeal?: {
    attempted: boolean;
    result: 'not_attempted' | 'succeeded' | 'failed';
    reason: string;
  };
}): string {
  const audit = buildRefResolutionAudit(input);
  this.traceStore.recordRefResolutionAudit(audit.auditId, audit);
  return audit.auditId;
}
```

- [ ] **Step 7: Record audits for ref-service resolution failures**

In `executeMutation()` and `executeRefRead()`, when `resolution.state !== 'live' || !resolution.ref`:

1. If `resolution.ref` is weakened, call `shouldAttemptWeakenedRefSelfHeal(kind, resolution.ref)`.
2. If the decision allows, do not immediately fail. Continue to execute with `resolution.ref`, but record a self-heal audit with:

```ts
selfHeal: {
  attempted: true,
  result: 'succeeded',
  reason: decision.reason,
}
```

3. If the decision denies, record an audit and include `refResolutionAuditId` in error diagnostics:

```ts
const auditId = this.recordRefResolutionAudit({
  observation: before,
  targetRef: refId,
  actionKind: kind,
  failureCode: resolution.state === 'weakened' ? 'low_confidence_ref' : 'stale_ref',
  diagnostics: {
    resolutionState: resolution.state,
    resolutionReason: resolution.reason,
    confidence: resolution.confidence,
    selfHealDecision: decision.reason,
  },
  selfHeal: {
    attempted: decision.allow,
    result: 'not_attempted',
    reason: decision.reason,
  },
});
```

Then return the existing failure result with diagnostics:

```ts
mapResolutionError(resolution.state, {
  refResolutionAuditId: auditId,
  resolutionState: resolution.state,
  resolutionReason: resolution.reason,
  confidence: resolution.confidence,
})
```

- [ ] **Step 8: Record audits for InputService execution failures**

In `executeMutation()` catch block, after `const result = this.failureResult...`, if `result.error` exists and `targetRef` exists:

```ts
const auditId = this.recordRefResolutionAudit({
  observation: before,
  targetRef: refId,
  actionKind: kind,
  failureCode: result.error.code,
  diagnostics: result.error.diagnostics,
});
result.error.diagnostics = {
  ...(result.error.diagnostics ?? {}),
  refResolutionAuditId: auditId,
};
```

Do the same in `executeRefRead()` catch block.

- [ ] **Step 9: Run harness-adjacent tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/traceStore.test.ts tests/unit/v2/failureClassifier.test.ts
```

Expected: pass.

---

## Task 7: Add Ref Resolution Audit Summary Script

**Files:**
- Create: `D:\BrowseGent\tests\benchmark\v2\ref_resolution_audit_summary.ts`

- [ ] **Step 1: Create summary script**

Create `D:\BrowseGent\tests\benchmark\v2\ref_resolution_audit_summary.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface AuditArtifact {
  failureCode?: string;
  actionKind?: string;
  summary?: {
    reason?: string;
    candidateCount?: number;
    sameRoleNameCandidates?: number;
    visibleReadyCandidates?: number;
  };
  selfHeal?: {
    attempted?: boolean;
    result?: string;
    reason?: string;
  };
}

async function findTraceFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === 'trace.json') {
        output.push(path);
      }
    }
  }
  await walk(root);
  return output;
}

function increment(map: Record<string, number>, key: string | undefined): void {
  const safeKey = key || 'unknown';
  map[safeKey] = (map[safeKey] ?? 0) + 1;
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? 'logs');
  const traceFiles = await findTraceFiles(root);
  const artifacts: AuditArtifact[] = [];

  for (const traceFile of traceFiles) {
    const trace = JSON.parse(await readFile(traceFile, 'utf8')) as {
      artifacts?: { refResolutionAudits?: Array<{ path: string }> };
    };
    for (const artifact of trace.artifacts?.refResolutionAudits ?? []) {
      artifacts.push(JSON.parse(await readFile(artifact.path, 'utf8')) as AuditArtifact);
    }
  }

  const byFailureCode: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  let selfHealAttempts = 0;
  let selfHealSuccesses = 0;

  for (const artifact of artifacts) {
    increment(byFailureCode, artifact.failureCode);
    increment(byReason, artifact.summary?.reason);
    increment(byAction, artifact.actionKind);
    if (artifact.selfHeal?.attempted) {
      selfHealAttempts += 1;
    }
    if (artifact.selfHeal?.result === 'succeeded') {
      selfHealSuccesses += 1;
    }
  }

  console.log(JSON.stringify({
    root,
    traceCount: traceFiles.length,
    auditArtifactCount: artifacts.length,
    byFailureCode,
    byReason,
    byAction,
    selfHealAttempts,
    selfHealSuccesses,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run script against unit traces**

Run:

```powershell
npx.cmd tsx tests/benchmark/v2/ref_resolution_audit_summary.ts logs/v2-unit-traces
```

Expected: prints JSON. `auditArtifactCount` can be `0` before runtime tests generate audit artifacts.

---

## Task 8: Full Verification And Benchmark Smoke

**Files:**
- All modified files from Tasks 1-7.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/failureClassifier.test.ts tests/unit/v2/refResolutionAudit.test.ts tests/unit/v2/refSelfHealingPolicy.test.ts tests/unit/v2/refResolver.test.ts tests/unit/v2/traceStore.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full unit suite**

Run:

```powershell
npm.cmd run test:unit
```

Expected: pass.

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: pass.

- [ ] **Step 4: Run V2 checks**

Run:

```powershell
npm.cmd run check:v2
```

Expected: pass.

- [ ] **Step 5: Run one BrowseGent MVR5-stable smoke benchmark**

Use key index `2` only if available. If the operator assigns another fresh key, change only the number after `--key-index`.

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 2
```

Expected: benchmark completes or fails for normal environment/model reasons. A2 verification depends on trace artifacts, not one-run score.

- [ ] **Step 6: Summarize compact telemetry**

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/compact_telemetry_summary.ts $latestRunDir
```

Expected: compact telemetry remains present. A2 must not break A1 artifacts.

- [ ] **Step 7: Summarize ref-resolution audits**

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/ref_resolution_audit_summary.ts $latestRunDir
```

Expected: JSON summary prints ref-resolution audit counts by failure code/reason/action and self-heal attempts.

---

## Acceptance Gates For A2

A2 is complete only if:

- Diagnostics propagate from `V2OperationalError` to `V2ToolError`, `FailureEvidence`, planner `lastResult.error`, and trace artifacts.
- Ref-resolution audit artifacts are written for failed and self-healed target resolution paths.
- Weakened refs are self-healed only through the conservative policy and existing runtime resolver verification.
- `RefResolver` exposes candidate diagnostics and only breaks ties with a real semantic identity signal.
- `npm.cmd run test:unit`, `npm.cmd run build`, and `npm.cmd run check:v2` pass.
- A benchmark smoke run still writes A1 compact telemetry artifacts.
- No planner prompt, planner API, benchmark scoring, or site-specific logic is changed.

## Expected Outcome

A2 may not immediately increase strict score. The expected improvement is:

- fewer opaque `ambiguous_ref_resolution` and `low_confidence_ref` failures,
- fewer repeated planner calls after mechanical target failures,
- traceable self-heal decisions,
- clearer evidence for whether A3/A4 compact enforcement is safe.

If A2 increases wrong-click or wrong-type behavior, revert self-heal behavior first and keep diagnostics/audit artifacts.

