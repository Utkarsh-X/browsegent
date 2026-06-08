# Phase A1 Compact View Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime compact planner-view telemetry that measures whether BrowseGent can produce a much smaller graph-derived planner state without changing planner prompts, planner behavior, or tool execution.

**Architecture:** Generate a compact planner view beside the existing `PlannerInput`, record it as a trace artifact, and summarize size/coverage metrics after benchmark runs. This phase is telemetry-only: the real planner still receives the current full `PlannerInput`.

**Tech Stack:** TypeScript, Node test runner, BrowseGent V2 runtime, `TraceStore`, `V2AgentLoop`, existing WebVoyager-lite benchmark traces.

---

## Non-Negotiable Scope Rules

- Do not change `PlannerPrompt.ts`.
- Do not change `V2PlannerClient.ts` request payloads.
- Do not make the planner consume compact view.
- Do not tune for individual WebVoyager tasks.
- Do not change benchmark scoring.
- Do not touch or commit API key files, `new-keys.yaml`, `debug.log`, or benchmark logs.
- Do not implement Phase A2 self-healing in this plan.

This plan must only add observability.

## Source Documents

- `D:\BrowseGent\docs\superpowers\specs\2026-06-07-compact-graph-planner-architecture-doctrine.md`
- `D:\BrowseGent\docs\superpowers\plans\2026-06-07-phase-a1-plus-compact-graph-efficiency-roadmap.md`

## File Map

- Create `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`
  - Runtime-safe compact planner view builder, byte measurement, plain interactive snapshot baseline, and planned-ref coverage calculation.
- Modify `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`
  - Move imports from benchmark prototype to runtime module and add coverage/baseline tests.
- Modify `D:\BrowseGent\src\v2\trace\types.ts`
  - Add `planner_compact_view` artifact kind and `compactPlannerViews` manifest array.
- Modify `D:\BrowseGent\src\v2\trace\TraceStore.ts`
  - Add `recordCompactPlannerView()` and write compact artifacts under `compact-planner/`.
- Modify `D:\BrowseGent\tests\unit\v2\traceStore.test.ts`
  - Verify compact planner telemetry artifacts are written and appear in manifest.
- Modify `D:\BrowseGent\src\v2\agent\types.ts`
  - Add optional `recordCompactPlannerView()` to `V2AgentHarnessRuntime`.
- Modify `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`
  - Forward `recordCompactPlannerView()` to `TraceStore`.
- Modify `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`
  - Build and record compact telemetry for normal planner episodes and finalization episodes.
- Modify `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`
  - Extend fake harness and verify planner input is unchanged while compact telemetry is recorded.
- Create `D:\BrowseGent\tests\benchmark\v2\compact_telemetry_summary.ts`
  - Summarize compact/current byte ratio and planned-ref coverage from trace artifacts.

---

## Task 1: Move Compact Planner View Into Runtime Module

**Files:**
- Create: `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`

- [ ] **Step 1: Write failing tests for runtime import, baseline, and coverage**

Replace the import in `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`:

```ts
import {
  buildCompactPlannerView,
  buildPlainInteractiveSnapshotBaseline,
  evaluateCompactPlannerCoverage,
  measureCompactPlannerView,
} from '../../../src/v2/planner/CompactPlannerView';
```

Append this test to the same file:

```ts
test('compact planner view exposes baseline and planned-ref coverage without mutating planner input', () => {
  const input = {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_coverage',
    goal: 'Click submit',
    current: {
      refs: {
        ref_submit: { kind: 'button', role: 'button', name: 'Submit', text: 'Submit' },
        ref_cancel: { kind: 'button', role: 'button', name: 'Cancel', text: 'Cancel' },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [{ refId: 'ref_submit', kind: 'button', name: 'Submit' }],
      secondaryRefs: [{ refId: 'ref_cancel', kind: 'button', name: 'Cancel' }],
      readableEvidence: [{ refId: 'ref_result', text: 'Result: ready' }],
      actionSurface: {
        clickableRefs: ['ref_submit', 'ref_cancel'],
        readableRefs: ['ref_result'],
      },
    },
    continuity: {
      snapshotId: 'graph_obs_1_1',
      observationId: 'obs_1',
      generationId: 1,
      url: 'https://example.test/form',
      refCount: 3,
      presentRefCount: 3,
      regionCount: 1,
      transitionCount: 0,
    },
    uncertainty: { level: 'none', signals: [] },
  };
  const before = JSON.stringify(input);

  const view = buildCompactPlannerView(input as any);
  const baseline = buildPlainInteractiveSnapshotBaseline(input as any);
  const coverage = evaluateCompactPlannerCoverage(view, {
    plan: [{ tool: 'click', ref: 'ref_submit' }],
    confidence: 'high',
  } as any);

  assert.equal(JSON.stringify(input), before);
  assert.equal(view.episodeId, 'episode_coverage');
  assert.equal(view.observationEpoch?.observationId, 'obs_1');
  assert.equal(view.actions.length, 2);
  assert.equal(view.reads.length, 1);
  assert.equal(baseline.refs.length, 2);
  assert.equal(coverage.plannedRefs.length, 1);
  assert.equal(coverage.actionRefCoverage, 1);
  assert.deepEqual(coverage.missingPlannedActionRefs, []);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/compactPlannerView.test.ts
```

Expected: fails because `src/v2/planner/CompactPlannerView` does not exist.

- [ ] **Step 3: Create the runtime module**

Create `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts` by adapting the current benchmark prototype from `D:\BrowseGent\tests\benchmark\v2\compact_planner_view.ts`.

The module must export these names:

```ts
export interface CompactPlannerView {
  version: 'compact_planner_view.v1';
  episodeId?: string;
  goal: string;
  url?: string;
  mode?: string;
  observationEpoch?: {
    observationId?: string;
    generationId?: number;
    snapshotId?: string;
  };
  lastResult?: unknown;
  recovery?: unknown;
  uncertainty?: unknown;
  actions: CompactActionRef[];
  reads: CompactReadRef[];
  omitted: {
    originalCurrentRefs: number;
    originalPrimaryRefs: number;
    originalSecondaryRefs: number;
    originalReadableEvidence: number;
  };
}

export interface CompactActionRef {
  id: number;
  refId: string;
  kind?: string;
  role?: string;
  label: string;
  tools: string[];
}

export interface CompactReadRef {
  id: number;
  refId: string;
  text: string;
}

export interface PlainInteractiveSnapshotBaseline {
  version: 'plain_interactive_snapshot_baseline.v1';
  episodeId?: string;
  refs: Array<{
    id: number;
    refId: string;
    role?: string;
    name?: string;
    text?: string;
    tools: string[];
  }>;
}

export interface CompactPlannerViewStats {
  originalBytes: number;
  compactBytes: number;
  baselineBytes: number;
  reductionRatio: number;
  baselineRatio: number;
}

export interface CompactPlannerCoverage {
  plannedRefs: string[];
  plannedActionRefs: string[];
  plannedReadRefs: string[];
  missingPlannedActionRefs: string[];
  missingPlannedReadRefs: string[];
  actionRefCoverage: number;
  readRefCoverage: number;
}
```

Required functions:

```ts
export function buildCompactPlannerView(input: Record<string, any>, options: { maxActions?: number; maxReads?: number } = {}): CompactPlannerView
export function buildPlainInteractiveSnapshotBaseline(input: Record<string, any>, options: { maxRefs?: number } = {}): PlainInteractiveSnapshotBaseline
export function measureCompactPlannerView(input: Record<string, any>, view: CompactPlannerView, baseline = buildPlainInteractiveSnapshotBaseline(input)): CompactPlannerViewStats
export function evaluateCompactPlannerCoverage(view: CompactPlannerView, plannerOutput?: { plan?: Array<{ tool?: string; ref?: string }> }): CompactPlannerCoverage
```

Implementation rules:

- Default `maxActions` to `24`.
- Default `maxReads` to `16`.
- Default baseline `maxRefs` to `48`.
- Use `input.continuity.observationId`, `input.continuity.generationId`, and `input.continuity.snapshotId` for `observationEpoch`.
- Build actions from `workingSet.primaryRefs` followed by `workingSet.secondaryRefs`, but only include refs that appear in `workingSet.actionSurface`.
- Build reads from `workingSet.readableEvidence`.
- Deduplicate labels by exact string.
- Truncate action labels to `180` chars.
- Truncate read text to `220` chars.
- Calculate byte lengths with `Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')`.
- Do not mutate `input`.

- [ ] **Step 4: Run compact-view tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/compactPlannerView.test.ts
```

Expected: all tests in the file pass.

---

## Task 2: Add Compact Planner View Trace Artifacts

**Files:**
- Modify: `D:\BrowseGent\src\v2\trace\types.ts`
- Modify: `D:\BrowseGent\src\v2\trace\TraceStore.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\traceStore.test.ts`

- [ ] **Step 1: Write failing TraceStore test**

Append this test to `D:\BrowseGent\tests\unit\v2\traceStore.test.ts`:

```ts
test('TraceStore writes compact planner view artifacts and manifest entries', async () => {
  const traceDir = await freshTraceDir('compact_planner_view');
  const store = new TraceStore({
    runId: 'run_trace_compact_view',
    runtimeMode: 'agent',
    traceDir,
    startTime: 5555,
  });

  const payload = {
    version: 'compact_planner_telemetry.v1',
    episodeId: 'episode_1_obs_1',
    stats: {
      originalBytes: 1000,
      compactBytes: 250,
      baselineBytes: 300,
      reductionRatio: 0.25,
      baselineRatio: 0.3,
    },
    coverage: {
      plannedRefs: ['ref_submit'],
      plannedActionRefs: ['ref_submit'],
      plannedReadRefs: [],
      missingPlannedActionRefs: [],
      missingPlannedReadRefs: [],
      actionRefCoverage: 1,
      readRefCoverage: 1,
    },
    view: {
      version: 'compact_planner_view.v1',
      goal: 'Click submit',
      actions: [{ id: 1, refId: 'ref_submit', label: 'Submit', tools: ['clickable'] }],
      reads: [],
      omitted: {
        originalCurrentRefs: 1,
        originalPrimaryRefs: 1,
        originalSecondaryRefs: 0,
        originalReadableEvidence: 0,
      },
    },
  };

  const artifact = store.recordCompactPlannerView('episode_1_obs_1', payload);
  const manifest = await store.flush();

  assert.equal(artifact.kind, 'planner_compact_view');
  assert.equal(manifest.artifacts.compactPlannerViews?.length, 1);
  assert.equal(manifest.artifacts.compactPlannerViews?.[0].id, 'episode_1_obs_1-compact');

  const compactJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_compact_view', 'compact-planner', 'episode_1_obs_1-compact.json'),
    'utf8',
  ));
  const traceJson = JSON.parse(await readFile(join(traceDir, 'run_trace_compact_view', 'trace.json'), 'utf8'));

  assert.equal(compactJson.version, 'compact_planner_telemetry.v1');
  assert.equal(compactJson.stats.reductionRatio, 0.25);
  assert.equal(traceJson.artifacts.compactPlannerViews[0].kind, 'planner_compact_view');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/traceStore.test.ts
```

Expected: fails because `recordCompactPlannerView` and manifest compact entries do not exist.

- [ ] **Step 3: Update trace types**

In `D:\BrowseGent\src\v2\trace\types.ts`:

- Add `'planner_compact_view'` to `TraceArtifactKind`.
- Add this optional field to `TraceManifest['artifacts']`:

```ts
compactPlannerViews?: TraceArtifact[];
```

- [ ] **Step 4: Update TraceStore**

In `D:\BrowseGent\src\v2\trace\TraceStore.ts`:

- Add a private map:

```ts
private readonly compactPlannerViews = new Map<string, TracePlannerRecord>();
```

- Add method:

```ts
recordCompactPlannerView(episodeId: string, payload: unknown): TraceArtifact {
  const id = `${episodeId}-compact`;
  const artifact = this.createArtifact('planner_compact_view', id, 'compact-planner', `${id}.json`);
  this.compactPlannerViews.set(id, {
    artifact,
    payload: toTraceJsonValue(payload),
  });
  return artifact;
}
```

- In `flush()`, create the directory:

```ts
await mkdir(join(runRoot, 'compact-planner'), { recursive: true });
```

- In `flush()`, write the compact artifacts:

```ts
for (const record of this.compactPlannerViews.values()) {
  await writeFile(record.artifact.path, stringifyTraceJson(record.payload), 'utf8');
}
```

- In `createManifest()`, include:

```ts
compactPlannerViews: [...this.compactPlannerViews.values()].map((record) => record.artifact),
```

- [ ] **Step 5: Run TraceStore tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/traceStore.test.ts
```

Expected: pass.

---

## Task 3: Expose Compact Telemetry Recording Through Harness Runtime

**Files:**
- Modify: `D:\BrowseGent\src\v2\agent\types.ts`
- Modify: `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`

- [ ] **Step 1: Update runtime interface**

In `D:\BrowseGent\src\v2\agent\types.ts`, add this optional method to `V2AgentHarnessRuntime`:

```ts
recordCompactPlannerView?(episodeId: string, payload: unknown): TraceArtifact;
```

- [ ] **Step 2: Add harness forwarding method**

In `D:\BrowseGent\src\v2\harness\BrowseGentV2Harness.ts`, add this public method near the existing planner record methods:

```ts
recordCompactPlannerView(episodeId: string, payload: unknown): TraceArtifact {
  return this.traceStore.recordCompactPlannerView(episodeId, payload);
}
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: TypeScript passes.

---

## Task 4: Record Compact Planner Telemetry In V2AgentLoop

**Files:**
- Modify: `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`

- [ ] **Step 1: Extend FakeHarness in test**

In `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`, add this property to `FakeHarness`:

```ts
compactPlannerViews: Array<{ episodeId: string; payload: unknown }> = [];
```

Add this method to `FakeHarness`:

```ts
recordCompactPlannerView(episodeId: string, payload: unknown): TraceArtifact {
  this.compactPlannerViews.push({ episodeId, payload });
  return { kind: 'planner_compact_view', id: `${episodeId}-compact`, path: `${episodeId}-compact.json` };
}
```

In `flushTrace()`, add this manifest artifact field:

```ts
compactPlannerViews: [],
```

- [ ] **Step 2: Add failing V2AgentLoop telemetry test**

Append this test to `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`:

```ts
test('V2AgentLoop records compact planner telemetry without changing planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([{ plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' }, { done: true, val: 'Clicked' }]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(harness.plannerInputs.length, 2);
  assert.equal(harness.compactPlannerViews.length, 2);
  assert.equal(harness.compactPlannerViews[0].episodeId, harness.plannerInputs[0].episodeId);

  const firstPayload = harness.compactPlannerViews[0].payload as {
    version?: string;
    stats?: { originalBytes?: number; compactBytes?: number; reductionRatio?: number };
    coverage?: { plannedRefs?: string[]; actionRefCoverage?: number };
    view?: { version?: string; actions?: Array<{ refId: string }> };
  };

  assert.equal(firstPayload.version, 'compact_planner_telemetry.v1');
  assert.equal(firstPayload.view?.version, 'compact_planner_view.v1');
  assert.ok((firstPayload.stats?.originalBytes ?? 0) > 0);
  assert.ok((firstPayload.stats?.compactBytes ?? 0) > 0);
  assert.ok((firstPayload.stats?.reductionRatio ?? 1) < 1);
  assert.deepEqual(firstPayload.coverage?.plannedRefs, ['ref_submit']);
  assert.equal(firstPayload.coverage?.actionRefCoverage, 1);
  assert.deepEqual(planner.inputs[0], harness.plannerInputs[0].input);
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/v2AgentLoop.test.ts
```

Expected: fails because `V2AgentLoop` does not record compact telemetry yet.

- [ ] **Step 4: Import compact telemetry helpers**

At the top of `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`, add:

```ts
import {
  buildCompactPlannerView,
  buildPlainInteractiveSnapshotBaseline,
  evaluateCompactPlannerCoverage,
  measureCompactPlannerView,
} from '../planner/CompactPlannerView';
```

- [ ] **Step 5: Add local telemetry helper**

Near the bottom of `V2AgentLoop.ts`, before `appendBoundedFailure`, add:

```ts
function recordCompactPlannerTelemetry(input: {
  harness: V2AgentHarnessRuntime;
  plannerInput: PlannerInput;
  plannerOutput?: PlannerOutput;
  mode: 'normal' | 'finalization';
}): void {
  if (!input.harness.recordCompactPlannerView) {
    return;
  }

  const compactView = buildCompactPlannerView(input.plannerInput);
  const baseline = buildPlainInteractiveSnapshotBaseline(input.plannerInput);
  const stats = measureCompactPlannerView(input.plannerInput, compactView, baseline);
  const coverage = evaluateCompactPlannerCoverage(compactView, input.plannerOutput);

  input.harness.recordCompactPlannerView(input.plannerInput.episodeId, {
    version: 'compact_planner_telemetry.v1',
    episodeId: input.plannerInput.episodeId,
    mode: input.mode,
    plannerInputVersion: input.plannerInput.version,
    stats,
    coverage,
    observationEpoch: compactView.observationEpoch,
    omitted: compactView.omitted,
    view: compactView,
    plainInteractiveBaseline: baseline,
  });
}
```

- [ ] **Step 6: Record telemetry for normal planner episodes**

In the main loop, after successful `plannerClient.call()` and before `harness.recordPlannerOutput?.(...)`, call:

```ts
recordCompactPlannerTelemetry({
  harness,
  plannerInput,
  plannerOutput: plannerResult.output,
  mode: 'normal',
});
```

In the planner-client `catch` block, before returning from the error path, call:

```ts
recordCompactPlannerTelemetry({
  harness,
  plannerInput,
  mode: 'normal',
});
```

This preserves telemetry even when the provider fails.

- [ ] **Step 7: Record telemetry for finalization episodes**

In `attemptFinalization()`, after the finalization planner call succeeds and before `harness.recordPlannerOutput?.(...)`, call:

```ts
recordCompactPlannerTelemetry({
  harness,
  plannerInput: finalizationInput,
  plannerOutput: result.output,
  mode: 'finalization',
});
```

In the finalization `catch`, call:

```ts
recordCompactPlannerTelemetry({
  harness,
  plannerInput: finalizationInput,
  mode: 'finalization',
});
```

Then keep the existing fallthrough behavior unchanged.

- [ ] **Step 8: Run V2AgentLoop tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/v2AgentLoop.test.ts
```

Expected: pass.

---

## Task 5: Add Compact Telemetry Summary Script

**Files:**
- Create: `D:\BrowseGent\tests\benchmark\v2\compact_telemetry_summary.ts`

- [ ] **Step 1: Create summary script**

Create `D:\BrowseGent\tests\benchmark\v2\compact_telemetry_summary.ts` with behavior:

- Accept one positional argument: a trace/log root path.
- Recursively find `trace.json` files.
- For each `trace.json`, read `artifacts.compactPlannerViews`.
- Read each compact artifact.
- Print:
  - trace count,
  - compact artifact count,
  - average compact/current ratio,
  - average plain-baseline/current ratio,
  - average action-ref coverage,
  - total missing planned action refs,
  - top five worst ratios by episode.

Use this implementation shape:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface CompactArtifact {
  episodeId?: string;
  stats?: {
    originalBytes?: number;
    compactBytes?: number;
    baselineBytes?: number;
    reductionRatio?: number;
    baselineRatio?: number;
  };
  coverage?: {
    actionRefCoverage?: number;
    missingPlannedActionRefs?: string[];
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

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? 'logs');
  const traceFiles = await findTraceFiles(root);
  const artifacts: CompactArtifact[] = [];

  for (const traceFile of traceFiles) {
    const trace = JSON.parse(await readFile(traceFile, 'utf8')) as {
      artifacts?: { compactPlannerViews?: Array<{ path: string }> };
    };
    for (const artifact of trace.artifacts?.compactPlannerViews ?? []) {
      artifacts.push(JSON.parse(await readFile(artifact.path, 'utf8')) as CompactArtifact);
    }
  }

  const validRatios = artifacts
    .map((artifact) => artifact.stats?.reductionRatio)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const validBaselineRatios = artifacts
    .map((artifact) => artifact.stats?.baselineRatio)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const validCoverage = artifacts
    .map((artifact) => artifact.coverage?.actionRefCoverage)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const missingActionRefs = artifacts.flatMap((artifact) => artifact.coverage?.missingPlannedActionRefs ?? []);
  const worstRatios = [...artifacts]
    .filter((artifact) => typeof artifact.stats?.reductionRatio === 'number')
    .sort((a, b) => (b.stats?.reductionRatio ?? 0) - (a.stats?.reductionRatio ?? 0))
    .slice(0, 5);

  const average = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  console.log(JSON.stringify({
    root,
    traceCount: traceFiles.length,
    compactArtifactCount: artifacts.length,
    averageCompactCurrentRatio: Number(average(validRatios).toFixed(4)),
    averagePlainBaselineCurrentRatio: Number(average(validBaselineRatios).toFixed(4)),
    averageActionRefCoverage: Number(average(validCoverage).toFixed(4)),
    missingPlannedActionRefCount: missingActionRefs.length,
    worstRatios: worstRatios.map((artifact) => ({
      episodeId: artifact.episodeId,
      reductionRatio: artifact.stats?.reductionRatio,
      originalBytes: artifact.stats?.originalBytes,
      compactBytes: artifact.stats?.compactBytes,
    })),
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
npx.cmd tsx tests/benchmark/v2/compact_telemetry_summary.ts logs/v2-unit-traces
```

Expected: prints JSON summary. If there are no compact artifacts yet, `compactArtifactCount` can be `0`.

---

## Task 6: Full Verification

**Files:**
- All modified files from Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/compactPlannerView.test.ts tests/unit/v2/traceStore.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: pass.

- [ ] **Step 2: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: TypeScript passes.

- [ ] **Step 3: Run V2 checks**

Run:

```powershell
npm.cmd run check:v2
```

Expected: both V2 checks pass.

- [ ] **Step 4: Run one MVR5-stable BrowseGent smoke benchmark**

Use key index `1` only if it is available for the current day. If the operator assigns another fresh key index, change only the numeric value after `--key-index`.

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 1
```

Expected: benchmark completes or fails for normal environment/model reasons. The important Phase A1 verification is that traces include `compact-planner/*.json` artifacts and `trace.json` contains `artifacts.compactPlannerViews`.

- [ ] **Step 5: Summarize compact telemetry**

Resolve the latest run directory and summarize it:

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/compact_telemetry_summary.ts $latestRunDir
```

Expected: JSON summary includes nonzero `compactArtifactCount`, average compact/current ratio, baseline/current ratio, and planned-ref coverage.

- [ ] **Step 6: Confirm no behavior change**

Manually verify these facts from the code diff:

- `PlannerPrompt.ts` unchanged.
- `V2PlannerClient.ts` unchanged.
- Existing `plannerInput` object is still passed to `plannerClient.call()`.
- Compact telemetry is recorded through trace methods only.
- No benchmark task IDs, website names, or golden answers were added to runtime code.

---

## Acceptance Gates For This Plan

This implementation is complete only if:

- Focused unit tests pass.
- `npm.cmd run build` passes.
- `npm.cmd run check:v2` passes.
- A BrowseGent benchmark run writes compact planner artifacts.
- Compact telemetry summary prints machine-readable JSON.
- Planner prompt and planner API behavior remain unchanged.

Do not proceed to Phase A2, A3, or compact enforcement until this telemetry produces enough data to answer:

- Is compact view consistently <= `35%` of current planner input?
- Does compact view preserve planned action refs?
- Is graph-derived compact view better than the plain interactive baseline?
- Which episodes have the worst compact/current ratios?
