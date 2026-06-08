# Phase A2 Ref Resolution Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the three A2 defects found in the first live trace before any A3 shadow-planner execution.

**Architecture:** Remove the unsafe ordinal tie-break, make audits derive reasons from resolver diagnostics, and prevent snapshot-only reads from being labeled as browser-verified self-heals. Preserve all useful A2 diagnostics and trace artifacts.

**Tech Stack:** TypeScript, Node test runner, BrowseGent V2 runtime and trace artifacts.

---

## Verified Defects

1. `RefResolver` computes `nthRoleName` against each candidate's own role/name/text. Many unrelated buttons therefore receive the same ordinal bonus, causing tied scores.
2. `RefResolutionAudit` selects candidates when any single role matches. On complex pages this produces 90-348 candidates and hides the actual resolver reason.
3. `executeRefRead()` records weakened reads as successful self-heals without resolving against the live browser. It only reads the observation snapshot.

## Scope Rules

- Do not add a new resolver strategy in this correction.
- Do not change planner prompts or planner inputs.
- Do not remove A2 diagnostics or audit artifacts.
- Do not tune for GitHub, Wolfram Alpha, or any website.

---

### Task 1: Remove Unsafe Ordinal Scoring

**Files:**
- Modify: `D:\BrowseGent\src\v2\substrate\RefResolver.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\refResolver.test.ts`

- [ ] **Step 1: Replace the current ordinal test**

Replace `RefResolver uses nthRoleName as a safe semantic tie breaker` with:

```ts
test('RefResolver does not award ordinal identity to unrelated same-role candidates', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => ({
        evaluate: async () => ({
          score: 120,
          identityKey: `button|${index}|candidate`,
          diagnostics: {
            nameMatched: false,
            textMatched: false,
          },
        }),
      }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({
      selectorCandidates: ['button'],
      nthRoleName: 1,
    }), fakePage),
    (error: unknown) => {
      const candidate = error as { code?: string; diagnostics?: Record<string, unknown> };
      assert.equal(candidate.code, 'ambiguous_ref_resolution');
      assert.equal(candidate.diagnostics?.reason, 'tied_candidates');
      return true;
    },
  );
});
```

- [ ] **Step 2: Run the test**

```powershell
npx.cmd tsx --test tests/unit/v2/refResolver.test.ts
```

Expected: the revised test passes only after ordinal scoring no longer invents uniqueness.

- [ ] **Step 3: Remove full-DOM ordinal calculation**

In `D:\BrowseGent\src\v2\substrate\RefResolver.ts`, remove:

- `document.querySelectorAll('*')`,
- `matching`,
- `roleNameOrdinal`,
- the `score += 12` ordinal bonus,
- `nthRoleNameMatched` and `roleNameOrdinal` diagnostics.

Keep exact tag, role, accessible-name, and text scoring unchanged.

- [ ] **Step 4: Run resolver tests**

```powershell
npx.cmd tsx --test tests/unit/v2/refResolver.test.ts
```

Expected: pass.

---

### Task 2: Make Audit Reasons Follow Runtime Diagnostics

**Files:**
- Modify: `D:\BrowseGent\src\v2\runtime\RefResolutionAudit.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\refResolutionAudit.test.ts`

- [ ] **Step 1: Add diagnostic-reason tests**

Append:

```ts
test('buildRefResolutionAudit preserves tied candidate resolver reason', () => {
  const observation = makeObservation([makeRef()]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit',
    actionKind: 'click',
    failureCode: 'ambiguous_ref_resolution',
    diagnostics: {
      reason: 'tied_candidates',
      candidateCount: 5,
      topScore: 130,
    },
  });

  assert.equal(audit.summary.reason, 'resolver_tied_candidates');
  assert.equal(audit.summary.candidateCount, 5);
});

test('buildRefResolutionAudit does not include every same-role element as a candidate', () => {
  const observation = makeObservation([
    makeRef(),
    makeRef({ refId: 'ref_other', targetId: 'target_other', name: 'Other', text: 'Other' }),
  ]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit',
    actionKind: 'click',
    failureCode: 'timeout',
  });

  assert.deepEqual(audit.candidates.map(candidate => candidate.refId), ['ref_submit']);
});
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
npx.cmd tsx --test tests/unit/v2/refResolutionAudit.test.ts
```

- [ ] **Step 3: Narrow candidate inclusion**

Change candidate inclusion to require one strong identity match:

```ts
return matchTargetId
  || matchName
  || matchText
  || (matchRole && matchNthRoleName);
```

Do not include candidates on role alone or ordinal alone.

- [ ] **Step 4: Extend summary reasons**

Add:

```ts
'resolver_tied_candidates'
| 'resolver_overflow_weak_selectors'
| 'resolver_no_verified_candidates'
| 'execution_timeout'
```

Choose summary reason in this precedence:

1. target absent,
2. target weakened,
3. diagnostics reason `tied_candidates`,
4. diagnostics reason `overflow_weak_selectors`,
5. diagnostics reason `no_verified_candidates`,
6. failure code `timeout`,
7. same role/name ambiguity,
8. blocked target,
9. generic runtime resolution failure.

When diagnostics contain numeric `candidateCount`, use it for `summary.candidateCount`. Keep the narrowed observation candidates separately.

- [ ] **Step 5: Run audit tests**

```powershell
npx.cmd tsx --test tests/unit/v2/refResolutionAudit.test.ts
```

Expected: pass.

---

### Task 3: Stop Claiming Snapshot Reads Are Browser-Verified Self-Heals

**Files:**
- Modify: `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`
- Modify: `D:\BrowseGent\src\v2\runtime\RefSelfHealingPolicy.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\refSelfHealingPolicy.test.ts`

- [ ] **Step 1: Add denied read-path test**

Append:

```ts
test('shouldAttemptWeakenedRefSelfHeal denies snapshot-only read operations', () => {
  assert.deepEqual(
    shouldAttemptWeakenedRefSelfHeal('get', makeRef({
      capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
    })),
    { allow: false, reason: 'read_path_not_browser_verified' },
  );
});
```

- [ ] **Step 2: Extend policy reason**

Add:

```ts
| 'read_path_not_browser_verified'
```

Before capability checks:

```ts
if (actionKind === 'get' || actionKind === 'inspect_region') {
  return { allow: false, reason: 'read_path_not_browser_verified' };
}
```

- [ ] **Step 3: Remove successful read self-heal audit**

In `executeRefRead()`, remove the branch that records:

```ts
result: 'succeeded'
```

for weakened refs. The policy will now reject that path and produce a normal low-confidence audit.

- [ ] **Step 4: Run policy and harness-adjacent tests**

```powershell
npx.cmd tsx --test tests/unit/v2/refSelfHealingPolicy.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: pass.

---

### Task 4: Verification

- [ ] **Step 1: Run focused tests**

```powershell
npx.cmd tsx --test tests/unit/v2/refResolutionAudit.test.ts tests/unit/v2/refSelfHealingPolicy.test.ts tests/unit/v2/refResolver.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

- [ ] **Step 2: Run full verification**

```powershell
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

- [ ] **Step 3: Run one MVR5-stable smoke**

Use a fresh operator-approved key index:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 3
```

- [ ] **Step 4: Inspect audits**

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/ref_resolution_audit_summary.ts $latestRunDir
```

Acceptance:

- no unrelated same-role candidates receive ordinal identity bonuses,
- audits report `resolver_tied_candidates`, `execution_timeout`, or another specific reason when evidence exists,
- snapshot-only reads never report successful self-healing,
- all verification commands pass.
