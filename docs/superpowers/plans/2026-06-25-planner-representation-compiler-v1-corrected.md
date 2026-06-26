# Planner Representation Compiler v1 Corrected Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Planner Representation Compiler (PRC) that replaces raw planner-input JSON with a compact, reasoning-oriented prompt representation while preserving BrowseGent's Brain1/Brain2/ref graph information contract.

**Architecture:** PRC compiles the existing `PlannerInput` into a typed intermediate representation, then renders it into compact text for the planner. It must read full element facts from `current.refs`, use `interactions/readables/navigation` only as rank/lane indexes, preserve execution memory (`lastResult`, `failures`, `recovery`, `transition`, `answerFeedback`, `uncertainty`, `lineage`), and stay behind an explicit opt-in flag until trace replay and benchmark validation prove no quality regression.

**Tech Stack:** TypeScript, Node.js test runner, `tsx`, existing BrowseGent v2 planner/runtime types.

---

## Non-Negotiable Guardrails

- Do not modify `RefService`, `ContinuityGraph`, Brain1 observation/projection generation, runtime action execution, or benchmark scoring.
- Do not make PRC the default path in this implementation. Default must remain current JSON.
- Do not add website-specific logic, task-specific selectors, benchmark-specific prompts, or score-gaming behavior.
- Do not implement multiple syntax variants in v1. Use one compact line syntax and keep the type boundary open for future variants.
- Do not truncate `selectOptions`; select/dropdown correctness depends on full option labels.
- Do not drop failures, last result, transition, recovery, uncertainty, answer feedback, or lineage.
- Do not treat `current.interactions`, `current.readables`, or `current.navigation` entries as full refs. They are `SerializedProjectionItem` rank entries: `{ refId, rank }`.
- Do not add git commit steps unless explicitly requested by the user.

## Current Code Facts

- `src/v2/planner/PlannerPrompt.ts` currently sends raw JSON with `JSON.stringify(input)`.
- `PlannerInput.current.refs` is `Record<string, SerializedProjectionRef>` and contains full facts.
- `PlannerInput.current.interactions`, `readables`, and `navigation` are ranked lists containing only `{ refId, rank }`.
- Default healthy element values are currently `visibility: "visible"`, `actionability: "ready"`, `state: "live"`, and `confidence: 1`.
- `selectOptions` is `string[]`, not `string`.
- `src/v2/planner/CompactPlannerView.ts` already proves useful compact-view ideas, but it is not rich enough to replace the production planner input as-is.

## Target Prompt Shape

PRC rendered output should be compact, sectioned, and stable:

```text
MISSION
  goal: Find the latest quantum computing preprint

STATE
  page: "arXiv" https://arxiv.org/search
  observation: obs_9 gen=3 refs=305
  focus: v2ref_14 highest_operational_score

RECENT EVENTS
  last: click v2ref_30 -> failed timeout retryable=true
  transition: microstate urlChanged=false appeared=0 disappeared=0 weakened=0 preserved=305

PROBLEMS
  failure: v2ref_30 timeout x2 transient retryable=true
  uncertainty: medium failure:timeout

PLANNER SURFACE
  Search Form (region_form_1)
    [v2ref_14] <input name="Search term" lane="interaction" tier="top" />
    [v2ref_15] <select name="Field" lane="interaction" tier="top" options="All fields | Title | Author" />
  Repeated link controls (region_repeated_1, omitted 18 of 20)
    [v2ref_60] <link name="Computer Science" lane="navigation" tier="mid" region="region_repeated_1" />

WORKING SET
  mode: recover
  primary: v2ref_14(goal_keyword_match,visible_ready), v2ref_30(last_failure)
  navigation: v2ref_60(navigation_candidate)
  omitted: observed=305 selected=24 dropped=281

DECISION SIGNALS
  action surface: click=v2ref_30 type=v2ref_14 select=v2ref_15 read=v2ref_90
  suppressed: duplicate_region_member=18 navigation_overflow=40
```

## Files

- Create: `src/v2/planner/prc/types.ts`
- Create: `src/v2/planner/prc/PlannerRepresentationCompiler.ts`
- Create: `src/v2/planner/prc/PromptLayoutEngine.ts`
- Create: `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts`
- Create: `tests/unit/v2/prc/promptLayoutEngine.test.ts`
- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`
- Modify: `tests/unit/v2/v2PlannerClient.test.ts`

## Task 1: Add PRC Types and Opt-In Config

**Files:**
- Create: `src/v2/planner/prc/types.ts`
- Modify: `src/v2/planner/types.ts`
- Test: `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts`

- [ ] **Step 1.1: Write failing type/invariant test**

Create `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function makeInput(): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'ep_prc_1',
    goal: 'Search quantum computing',
    current: {
      projectionId: 'proj_1',
      observationId: 'obs_1',
      generationId: 1,
      page: { url: 'https://example.test', title: 'Example' },
      focus: { refId: 'v2ref_1', reason: 'highest_operational_score' },
      refs: {
        v2ref_1: {
          refId: 'v2ref_1',
          kind: 'input',
          role: 'textbox',
          name: 'Search term',
          text: 'Search term',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 115,
          selectOptions: undefined,
        },
        v2ref_2: {
          refId: 'v2ref_2',
          kind: 'select',
          role: 'combobox',
          name: 'Field',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 115,
          selectOptions: ['All fields', 'Title', 'Author', 'Abstract'],
        },
        v2ref_3: {
          refId: 'v2ref_3',
          kind: 'button',
          role: 'button',
          name: 'Search',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 90,
        },
      },
      interactions: [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }, { refId: 'v2ref_3', rank: 3 }],
      readables: [],
      navigation: [],
      regions: [{ regionId: 'region_form_1', kind: 'form', label: 'Search Form', refIds: ['v2ref_1', 'v2ref_2', 'v2ref_3'], score: 115 }],
      warnings: [],
      stats: { interactionCount: 3, readableCount: 0, navigationCount: 0, regionCount: 1 },
    },
    workingSet: {
      mode: 'act',
      modeReason: 'initial',
      primaryRefs: [{ refId: 'v2ref_1', kind: 'input', name: 'Search term', score: 115, reasons: ['goal_keyword_match', 'visible_ready'] }],
      secondaryRefs: [{ refId: 'v2ref_2', kind: 'select', name: 'Field', score: 115, reasons: ['form_candidate'] }],
      readableEvidence: [],
      navigationRefs: [],
      actionSurface: { clickableRefs: ['v2ref_3'], typeableRefs: ['v2ref_1'], selectableRefs: ['v2ref_2'], readableRefs: [], ambiguousRefs: [] },
      changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 3, topRefs: [], omittedCount: 0 },
      failedRefs: [],
      quarantinedActions: [],
      regionSummaries: [{ regionId: 'region_form_1', label: 'Search Form', representativeRefs: ['v2ref_1', 'v2ref_2', 'v2ref_3'], omittedRefCount: 0 }],
      omitted: { observedRefCount: 3, selectedRefCount: 3, droppedRefCount: 0, droppedByReason: {} },
    },
    uncertainty: { level: 'none', signals: [] },
  };
}

test('PRC compiler resolves lane rank entries through current.refs', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const elements = ir.surface.groups.flatMap(group => group.elements);
  assert.equal(elements.length, 3);
  assert.equal(elements.find(el => el.refId === 'v2ref_1')?.name, 'Search term');
  assert.equal(elements.find(el => el.refId === 'v2ref_1')?.lane, 'interaction');
});

test('PRC compiler preserves selectOptions as full array', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const select = ir.surface.groups.flatMap(group => group.elements).find(el => el.refId === 'v2ref_2');
  assert.deepEqual(select?.selectOptions, ['All fields', 'Title', 'Author', 'Abstract']);
});
```

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/prc/plannerRepresentationCompiler.test.ts
```

Expected: fail because PRC module does not exist yet.

- [ ] **Step 1.2: Add config types**

In `src/v2/planner/types.ts`, add near planner input/output type declarations:

```typescript
export type PlannerSerializationMode = 'json' | 'prc';

export interface PlannerSerializationConfig {
  mode?: PlannerSerializationMode;
}
```

Do not add serialization config to `PlannerWorkingSetOptions`; this is prompt/client configuration, not working-set selection.

- [ ] **Step 1.3: Add PRC IR types**

Create `src/v2/planner/prc/types.ts`:

```typescript
import type {
  PlannerAnswerFeedback,
  PlannerContinuitySummary,
  PlannerDeadStateSummary,
  PlannerFailureSummary,
  PlannerLastResultSummary,
  PlannerTransitionSummary,
  PlannerUncertainty,
  CompressedLineage,
} from '../types';
import type { PlannerRecoveryState } from '../../runtime/RecoveryState';
import type { PlannerActionSurface, WorkingSetDropReason, WorkingSetIncludeReason, WorkingSetMode } from '../workingSetTypes';

export type PlannerElementLane = 'interaction' | 'readable' | 'navigation' | 'mixed';
export type PlannerScoreTier = 'top' | 'high' | 'mid' | 'low';

export interface PlannerElementIR {
  refId: string;
  kind: string;
  role?: string;
  name: string;
  text?: string;
  lane: PlannerElementLane;
  rank?: number;
  scoreTier: PlannerScoreTier;
  score: number;
  regionId?: string;
  selectOptions?: string[];
  anomalies: string[];
  failure?: { kind: string; count: number; retryable: boolean; persistence: string };
}

export interface PlannerRegionIR {
  regionId: string;
  label: string;
  kind: string;
  elements: PlannerElementIR[];
  omittedCount: number;
  totalCount: number;
}

export interface PlannerSurfaceIR {
  groups: PlannerRegionIR[];
  remainder: PlannerElementIR[];
  inputRefCount: number;
  surfaceRefCount: number;
}

export interface ExecutionContextIR {
  goal: string;
  page?: { title: string; url: string };
  focus?: { refId: string; reason: string };
  continuity?: PlannerContinuitySummary;
  transition?: PlannerTransitionSummary;
  lastResult?: PlannerLastResultSummary;
  failures: PlannerFailureSummary[];
  deadState?: PlannerDeadStateSummary;
  recovery?: PlannerRecoveryState;
  answerFeedback?: PlannerAnswerFeedback;
  uncertainty: PlannerUncertainty;
  lineage?: CompressedLineage;
}

export interface WorkingSetIR {
  mode?: WorkingSetMode;
  modeReason?: string;
  primary: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  secondary: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  navigation: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  failed: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  actionSurface?: PlannerActionSurface;
  omitted?: { observed: number; selected: number; dropped: number; byReason: Partial<Record<WorkingSetDropReason, number>> };
}

export interface DecisionSignalsIR {
  actionSurface?: PlannerActionSurface;
  suppressed?: { count: number; byReason: Partial<Record<WorkingSetDropReason, number>> };
}

export interface PlannerRepresentationStats {
  inputRefCount: number;
  surfaceRefCount: number;
  omittedRegionMembers: number;
  failureAnnotations: number;
  anomalyCount: number;
}

export interface PlannerRepresentationIR {
  execution: ExecutionContextIR;
  surface: PlannerSurfaceIR;
  workingSet?: WorkingSetIR;
  decisionSignals?: DecisionSignalsIR;
  stats: PlannerRepresentationStats;
}
```

## Task 2: Implement Compiler From Current BrowseGent Shapes

**Files:**
- Create: `src/v2/planner/prc/PlannerRepresentationCompiler.ts`
- Test: `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts`

- [ ] **Step 2.1: Implement compiler**

Create `src/v2/planner/prc/PlannerRepresentationCompiler.ts`:

```typescript
import type { SerializedProjection, SerializedProjectionItem, SerializedProjectionRef } from '../../brain1/projectionTypes';
import type { PlannerInput, PlannerFailureSummary } from '../types';
import type { PlannerElementIR, PlannerElementLane, PlannerRepresentationIR, PlannerScoreTier, WorkingSetIR } from './types';

export class PlannerRepresentationCompiler {
  compile(input: PlannerInput): PlannerRepresentationIR {
    const failureMap = buildFailureMap(input.failures ?? []);
    const surface = buildSurface(input.current, failureMap);
    const workingSet = input.workingSet ? buildWorkingSet(input.workingSet) : undefined;
    const decisionSignals = input.workingSet ? buildDecisionSignals(input.workingSet) : undefined;
    const allElements = [...surface.groups.flatMap(group => group.elements), ...surface.remainder];

    return {
      execution: {
        goal: input.goal,
        page: input.current.page,
        focus: input.current.focus,
        continuity: input.continuity,
        transition: input.transition,
        lastResult: input.lastResult,
        failures: input.failures ?? [],
        deadState: input.deadState,
        recovery: input.recovery,
        answerFeedback: input.answerFeedback,
        uncertainty: input.uncertainty,
        lineage: input.lineage,
      },
      surface,
      workingSet,
      decisionSignals,
      stats: {
        inputRefCount: surface.inputRefCount,
        surfaceRefCount: surface.surfaceRefCount,
        omittedRegionMembers: surface.groups.reduce((sum, group) => sum + group.omittedCount, 0),
        failureAnnotations: allElements.filter(element => element.failure).length,
        anomalyCount: allElements.reduce((sum, element) => sum + element.anomalies.length, 0),
      },
    };
  }
}

function buildSurface(current: SerializedProjection, failureMap: Map<string, PlannerElementIR['failure']>) {
  const laneByRef = new Map<string, { lane: PlannerElementLane; rank: number }>();
  addLane(laneByRef, current.interactions, 'interaction');
  addLane(laneByRef, current.readables, 'readable');
  addLane(laneByRef, current.navigation, 'navigation');

  const elementsByRef = new Map<string, PlannerElementIR>();
  for (const [refId, ref] of Object.entries(current.refs)) {
    const laneInfo = laneByRef.get(refId);
    elementsByRef.set(refId, normalizeElement(ref, laneInfo?.lane ?? 'mixed', laneInfo?.rank, failureMap.get(refId)));
  }

  const groupedRefs = new Set<string>();
  const groups = current.regions
    .map(region => {
      const regionElements = region.refIds
        .map(refId => elementsByRef.get(refId))
        .filter((element): element is PlannerElementIR => Boolean(element));
      for (const element of regionElements) groupedRefs.add(element.refId);
      const maxVisible = regionElements.length <= 5 ? regionElements.length : regionElements.length <= 20 ? 3 : 2;
      return {
        regionId: region.regionId,
        label: region.label,
        kind: region.kind,
        elements: regionElements.slice(0, maxVisible),
        omittedCount: Math.max(0, regionElements.length - maxVisible),
        totalCount: regionElements.length,
      };
    })
    .filter(group => group.totalCount > 0);

  const remainder = [...elementsByRef.values()].filter(element => !groupedRefs.has(element.refId));

  return {
    groups,
    remainder,
    inputRefCount: Object.keys(current.refs).length,
    surfaceRefCount: groups.reduce((sum, group) => sum + group.elements.length, 0) + remainder.length,
  };
}

function addLane(target: Map<string, { lane: PlannerElementLane; rank: number }>, items: SerializedProjectionItem[], lane: PlannerElementLane): void {
  for (const item of items) {
    const existing = target.get(item.refId);
    target.set(item.refId, { lane: existing ? 'mixed' : lane, rank: Math.min(existing?.rank ?? item.rank, item.rank) });
  }
}

function normalizeElement(
  ref: SerializedProjectionRef,
  lane: PlannerElementLane,
  rank: number | undefined,
  failure: PlannerElementIR['failure'],
): PlannerElementIR {
  const anomalies: string[] = [];
  if (ref.visibility !== 'visible') anomalies.push(`visibility=${ref.visibility}`);
  if (ref.actionability !== 'ready') anomalies.push(`actionability=${ref.actionability}`);
  if (ref.state !== 'live') anomalies.push(`state=${ref.state}`);
  if (ref.confidence < 1) anomalies.push(`confidence=${ref.confidence.toFixed(2)}`);

  return {
    refId: ref.refId,
    kind: ref.kind,
    role: ref.role,
    name: ref.name ?? ref.text ?? ref.refId,
    text: ref.text && ref.text !== ref.name ? ref.text : undefined,
    lane,
    rank,
    scoreTier: scoreTier(ref.score),
    score: ref.score,
    regionId: ref.regionId,
    selectOptions: ref.selectOptions,
    anomalies,
    failure,
  };
}

function scoreTier(score: number): PlannerScoreTier {
  if (score >= 110) return 'top';
  if (score >= 90) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
}

function buildFailureMap(failures: PlannerFailureSummary[]) {
  const map = new Map<string, { kind: string; count: number; retryable: boolean; persistence: string }>();
  for (const failure of failures) {
    if (!failure.targetRef) continue;
    const existing = map.get(failure.targetRef);
    if (existing && existing.kind === failure.kind) {
      existing.count++;
      existing.retryable = existing.retryable || failure.retryable;
    } else {
      map.set(failure.targetRef, {
        kind: failure.kind,
        count: 1,
        retryable: failure.retryable,
        persistence: failure.persistence,
      });
    }
  }
  return map;
}

function buildDecisionSignals(workingSet: NonNullable<PlannerInput['workingSet']>) {
  return {
    actionSurface: workingSet.actionSurface,
    suppressed: {
      count: workingSet.omitted.droppedRefCount,
      byReason: workingSet.omitted.droppedByReason,
    },
  };
}

function buildWorkingSet(workingSet: PlannerInput['workingSet']): WorkingSetIR {
  const compact = (refs: NonNullable<PlannerInput['workingSet']>['primaryRefs']) =>
    refs.map(ref => ({ refId: ref.refId, reasons: ref.reasons }));

  return {
    mode: workingSet?.mode,
    modeReason: workingSet?.modeReason,
    primary: compact(workingSet?.primaryRefs ?? []),
    secondary: compact(workingSet?.secondaryRefs ?? []),
    navigation: compact(workingSet?.navigationRefs ?? []),
    failed: compact(workingSet?.failedRefs ?? []),
    actionSurface: workingSet?.actionSurface,
    omitted: workingSet?.omitted ? {
      observed: workingSet.omitted.observedRefCount,
      selected: workingSet.omitted.selectedRefCount,
      dropped: workingSet.omitted.droppedRefCount,
      byReason: workingSet.omitted.droppedByReason,
    } : undefined,
  };
}
```

- [ ] **Step 2.2: Run compiler tests**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/prc/plannerRepresentationCompiler.test.ts
```

Expected: pass.

## Task 3: Add Prompt Layout Engine

**Files:**
- Create: `src/v2/planner/prc/PromptLayoutEngine.ts`
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts`

- [ ] **Step 3.1: Write renderer tests**

Create `tests/unit/v2/prc/promptLayoutEngine.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../../../../src/v2/planner/types';

const input: PlannerInput = {
  version: 'v2.planner_input.v2',
  episodeId: 'ep_render',
  goal: 'Click submit',
  current: {
    projectionId: 'proj',
    observationId: 'obs',
    generationId: 1,
    page: { url: 'https://example.test', title: 'Example' },
    refs: {
      r1: { refId: 'r1', kind: 'button', role: 'button', name: 'Submit', visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 },
      r2: { refId: 'r2', kind: 'input', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 90 },
    },
    interactions: [{ refId: 'r1', rank: 1 }, { refId: 'r2', rank: 2 }],
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    stats: { interactionCount: 2, readableCount: 0, navigationCount: 0, regionCount: 0 },
  },
  workingSet: {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [{ refId: 'r1', kind: 'button', name: 'Submit', score: 115, reasons: ['visible_ready'] }],
    secondaryRefs: [{ refId: 'r2', kind: 'input', name: 'Search', score: 90, reasons: ['form_candidate'] }],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: { clickableRefs: ['r1'], typeableRefs: ['r2'], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
    changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 2, topRefs: [], omittedCount: 0 },
    failedRefs: [],
    quarantinedActions: [],
    regionSummaries: [],
    omitted: { observedRefCount: 2, selectedRefCount: 2, droppedRefCount: 0, droppedByReason: {} },
  },
  failures: [{ failureId: 'f1', kind: 'timeout', category: 'timing', severity: 'warning', persistence: 'transient', retryable: true, targetRef: 'r1', signals: [] }],
  uncertainty: { level: 'medium', signals: ['failure:timeout'] },
};

test('PromptLayoutEngine renders mission first and compact element lines', () => {
  const ir = new PlannerRepresentationCompiler().compile(input);
  const text = new PromptLayoutEngine().render(ir);
  assert.match(text, /^MISSION/);
  assert.match(text, /\[r1\] <button name="Submit" lane="interaction" tier="top" failed="timeoutx1" \/>/);
  assert.match(text, /PROBLEMS/);
  assert.match(text, /DECISION SIGNALS/);
  assert.match(text, /action surface: click=r1 type=r2 select= read=/);
  assert.doesNotMatch(text, /"visibility":"visible"/);
  assert.doesNotMatch(text, /"actionability":"ready"/);
});
```

- [ ] **Step 3.2: Implement renderer**

Create `src/v2/planner/prc/PromptLayoutEngine.ts`:

```typescript
import type { PlannerElementIR, PlannerRepresentationIR } from './types';

export class PromptLayoutEngine {
  render(ir: PlannerRepresentationIR): string {
    return [
      renderMission(ir),
      renderState(ir),
      renderRecentEvents(ir),
      renderProblems(ir),
      renderSurface(ir),
      renderWorkingSet(ir),
      renderDecisionSignals(ir),
    ].filter(Boolean).join('\n\n');
  }
}

function renderMission(ir: PlannerRepresentationIR): string {
  return `MISSION\n  goal: ${ir.execution.goal}`;
}

function renderState(ir: PlannerRepresentationIR): string {
  const lines = ['STATE'];
  if (ir.execution.page) lines.push(`  page: "${ir.execution.page.title}" ${ir.execution.page.url}`);
  if (ir.execution.continuity) {
    lines.push(`  observation: ${ir.execution.continuity.observationId ?? 'unknown'} gen=${ir.execution.continuity.generationId ?? 'unknown'} refs=${ir.execution.continuity.presentRefCount}`);
  }
  if (ir.execution.focus) lines.push(`  focus: ${ir.execution.focus.refId} ${ir.execution.focus.reason}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderRecentEvents(ir: PlannerRepresentationIR): string {
  const lines = ['RECENT EVENTS'];
  const last = ir.execution.lastResult;
  if (last) {
    const result = last.success ? 'ok' : `failed ${last.error?.code ?? 'unknown'}`;
    lines.push(`  last: ${last.kind}${last.targetRef ? ` ${last.targetRef}` : ''} -> ${result}`);
  }
  const transition = ir.execution.transition;
  if (transition) {
    const c = transition.refChangeCounts;
    lines.push(`  transition: ${transition.transitionClass} urlChanged=${transition.urlChanged} appeared=${c.appeared} disappeared=${c.disappeared} weakened=${c.weakened} preserved=${c.preserved}`);
  }
  if (ir.execution.lineage && ir.execution.lineage.steps.length > 0) {
    lines.push(`  history: ${ir.execution.lineage.totalSteps} steps${ir.execution.lineage.truncated ? ' truncated' : ''}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderProblems(ir: PlannerRepresentationIR): string {
  const lines = ['PROBLEMS'];
  for (const failure of ir.execution.failures) {
    lines.push(`  failure: ${failure.targetRef ?? 'no_ref'} ${failure.kind} ${failure.persistence} retryable=${failure.retryable}`);
  }
  if (ir.execution.deadState) lines.push(`  dead_state: ${ir.execution.deadState.reasons.join(', ')}`);
  if (ir.execution.recovery) lines.push(`  recovery: ${ir.execution.recovery.state}`);
  if (ir.execution.answerFeedback) lines.push(`  answer_feedback: missing ${ir.execution.answerFeedback.missingDetails.join(', ')}`);
  if (ir.execution.uncertainty.level !== 'none') lines.push(`  uncertainty: ${ir.execution.uncertainty.level} ${ir.execution.uncertainty.signals.join(', ')}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderSurface(ir: PlannerRepresentationIR): string {
  const lines = ['PLANNER SURFACE'];
  for (const group of ir.surface.groups) {
    lines.push(`  ${group.label} (${group.regionId}${group.omittedCount ? `, omitted ${group.omittedCount} of ${group.totalCount}` : ''})`);
    for (const element of group.elements) lines.push(`    ${renderElement(element)}`);
  }
  if (ir.surface.remainder.length > 0) {
    lines.push('  Page Elements');
    for (const element of ir.surface.remainder) lines.push(`    ${renderElement(element)}`);
  }
  return lines.join('\n');
}

function renderElement(element: PlannerElementIR): string {
  const attrs = [
    `name="${escapeAttr(element.name)}"`,
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    `lane="${element.lane}"`,
    `tier="${element.scoreTier}"`,
    element.regionId ? `region="${escapeAttr(element.regionId)}"` : undefined,
    element.text ? `text="${escapeAttr(element.text)}"` : undefined,
    element.selectOptions?.length ? `options="${escapeAttr(element.selectOptions.join(' | '))}"` : undefined,
    element.anomalies.length ? `state="${escapeAttr(element.anomalies.join(','))}"` : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
  ].filter(Boolean);
  return `[${element.refId}] <${element.kind} ${attrs.join(' ')} />`;
}

function renderWorkingSet(ir: PlannerRepresentationIR): string {
  const ws = ir.workingSet;
  if (!ws) return '';
  const lines = ['WORKING SET'];
  if (ws.mode) lines.push(`  mode: ${ws.mode}${ws.modeReason ? ` ${ws.modeReason}` : ''}`);
  if (ws.primary.length) lines.push(`  primary: ${ws.primary.map(ref => `${ref.refId}(${ref.reasons.join(',')})`).join(', ')}`);
  if (ws.secondary.length) lines.push(`  secondary: ${ws.secondary.map(ref => `${ref.refId}(${ref.reasons.join(',')})`).join(', ')}`);
  if (ws.navigation.length) lines.push(`  navigation: ${ws.navigation.map(ref => `${ref.refId}(${ref.reasons.join(',')})`).join(', ')}`);
  if (ws.failed.length) lines.push(`  failed: ${ws.failed.map(ref => `${ref.refId}(${ref.reasons.join(',')})`).join(', ')}`);
  if (ws.omitted) lines.push(`  omitted: observed=${ws.omitted.observed} selected=${ws.omitted.selected} dropped=${ws.omitted.dropped}`);
  return lines.join('\n');
}

function renderDecisionSignals(ir: PlannerRepresentationIR): string {
  const signals = ir.decisionSignals;
  if (!signals) return '';
  const lines = ['DECISION SIGNALS'];
  if (signals.actionSurface) {
    lines.push(`  action surface: click=${signals.actionSurface.clickableRefs.join(',')} type=${signals.actionSurface.typeableRefs.join(',')} select=${signals.actionSurface.selectableRefs.join(',')} read=${signals.actionSurface.readableRefs.join(',')}`);
  }
  if (signals.suppressed && signals.suppressed.count > 0) {
    const reasons = Object.entries(signals.suppressed.byReason)
      .filter(([, count]) => typeof count === 'number' && count > 0)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(' ');
    lines.push(`  suppressed: ${signals.suppressed.count}${reasons ? ` ${reasons}` : ''}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 3.3: Run renderer tests**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts
```

Expected: pass.

## Task 4: Wire PRC Behind Explicit Opt-In

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Test: `tests/unit/v2/plannerPrompt.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 4.1: Add planner prompt tests**

In `tests/unit/v2/plannerPrompt.test.ts`, add tests proving JSON default and PRC opt-in.

```typescript
function makeMinimalPlannerInputForPromptTest(): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_prompt_prc',
    goal: 'Open docs',
    current: {
      projectionId: 'projection_1',
      observationId: 'obs_1',
      generationId: 1,
      page: { url: 'https://example.test', title: 'Example' },
      refs: {
        ref_docs: {
          refId: 'ref_docs',
          kind: 'link',
          role: 'link',
          name: 'Docs',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 115,
        },
      },
      interactions: [{ refId: 'ref_docs', rank: 1 }],
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: 1, readableCount: 0, navigationCount: 0, regionCount: 0 },
    },
    uncertainty: { level: 'none', signals: [] },
  };
}

test('buildV2PlannerUserMessage defaults to legacy JSON', () => {
  const input = makeMinimalPlannerInputForPromptTest();
  const message = buildV2PlannerUserMessage(input);
  assert.match(message, /^Planner input JSON:\n\{/);
  assert.match(message, /"current"/);
});

test('buildV2PlannerUserMessage renders PRC when explicitly requested', () => {
  const input = makeMinimalPlannerInputForPromptTest();
  const message = buildV2PlannerUserMessage(input, { mode: 'prc' });
  assert.match(message, /^Planner input:\nMISSION/);
  assert.match(message, /PLANNER SURFACE/);
  assert.doesNotMatch(message, /"visibility":"visible"/);
});
```

Also update the test imports:

```typescript
import type { PlannerInput } from '../../../src/v2/planner/types';
```

- [ ] **Step 4.2: Modify `PlannerPrompt.ts`**

Change `buildV2PlannerUserMessage` to accept optional config:

```typescript
import type { PlannerInput, PlannerSerializationConfig } from './types';
import { PlannerRepresentationCompiler } from './prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from './prc/PromptLayoutEngine';

export function buildV2PlannerUserMessage(
  input: PlannerInput,
  config: PlannerSerializationConfig = { mode: 'json' },
): string {
  if (config.mode === 'prc') {
    const ir = new PlannerRepresentationCompiler().compile(input);
    return `Planner input:\n${new PromptLayoutEngine().render(ir)}`;
  }

  return `Planner input JSON:\n${JSON.stringify(input)}`;
}
```

- [ ] **Step 4.3: Add client configuration without changing default behavior**

In `src/v2/planner/V2PlannerClient.ts`, update the type import:

```typescript
import type { PlannerInput, PlannerOutput, PlannerSerializationConfig } from './types';
```

Update `V2PlannerClientOptions` exactly:

```typescript
export interface V2PlannerClientOptions {
  provider?: V2PlannerProvider;
  traceStore?: Pick<TraceStore, 'recordPlannerInput' | 'recordPlannerOutput'>;
  schema?: PlannerOutputSchema;
  plannerSerialization?: PlannerSerializationConfig;
}
```

Add a private field:

```typescript
  private readonly plannerSerialization: PlannerSerializationConfig;
```

Initialize it in the constructor:

```typescript
  constructor(options: V2PlannerClientOptions = {}) {
    this.provider = options.provider ?? callProvider;
    this.schema = options.schema ?? new PlannerOutputSchema();
    this.traceStore = options.traceStore;
    this.plannerSerialization = options.plannerSerialization ?? { mode: 'json' };
  }
```

Change the user-message call site in `call()` from:

```typescript
const baseUserMessage = buildV2PlannerUserMessage(input.plannerInput);
```

to:

```typescript
const baseUserMessage = buildV2PlannerUserMessage(
  input.plannerInput,
  this.plannerSerialization,
);
```

Do not change benchmark command defaults in this task.

- [ ] **Step 4.4: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/prc/plannerRepresentationCompiler.test.ts tests/unit/v2/prc/promptLayoutEngine.test.ts
```

Expected: pass.

## Task 5: Add Trace-Replay Size and Fidelity Validation

**Files:**
- Create: `tests/unit/v2/prc/prcTraceReplay.test.ts`

- [ ] **Step 5.1: Add trace fixture replay test**

Create `tests/unit/v2/prc/prcTraceReplay.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function findPlannerInputFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findPlannerInputFiles(fullPath, out);
    } else if (entry.endsWith('-input.json')) {
      out.push(fullPath);
    }
  }
  return out;
}

function loadTraceInput(): PlannerInput | undefined {
  const files = findPlannerInputFiles(join(process.cwd(), 'logs', 'webvoyager-lite'));
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const candidate = (parsed.plannerInput ?? parsed) as Partial<PlannerInput>;
    if (candidate.version && candidate.current?.refs && candidate.current?.interactions && candidate.uncertainty) {
      return candidate as PlannerInput;
    }
  }
  return undefined;
}

test('PRC trace replay: compact render preserves key planner refs and is smaller than raw JSON', (t) => {
  const input = loadTraceInput();
  if (!input) {
    t.skip('No logs/webvoyager-lite planner input trace found');
    return;
  }

  const rawJson = `Planner input JSON:\n${JSON.stringify(input)}`;
  const ir = new PlannerRepresentationCompiler().compile(input);
  const rendered = `Planner input:\n${new PromptLayoutEngine().render(ir)}`;

  assert.ok(
    Buffer.byteLength(rendered, 'utf8') < Buffer.byteLength(rawJson, 'utf8'),
    'PRC render should be smaller than raw planner JSON',
  );

  const omittedIsExplicit = /omitted \d+ of \d+|omitted: observed=\d+ selected=\d+ dropped=\d+/.test(rendered);
  const surface = input.workingSet?.actionSurface;
  const actionRefs = new Set<string>([
    ...(surface?.clickableRefs ?? []),
    ...(surface?.typeableRefs ?? []),
    ...(surface?.selectableRefs ?? []),
    ...(surface?.readableRefs ?? []),
  ]);
  for (const refId of actionRefs) {
    assert.ok(
      rendered.includes(refId) || omittedIsExplicit,
      `action-surface ref ${refId} must be rendered or explicitly accounted for by omission summary`,
    );
  }

  for (const failure of input.failures ?? []) {
    if (!failure.targetRef) continue;
    assert.ok(rendered.includes(failure.targetRef), `failure target ${failure.targetRef} must appear in PRC render`);
  }

  const selectableRefs = new Set(surface?.selectableRefs ?? []);
  for (const ref of Object.values(input.current.refs)) {
    if (!selectableRefs.has(ref.refId) || !ref.selectOptions?.length) continue;
    assert.ok(rendered.includes(ref.refId), `selectable ref ${ref.refId} must be visible in PRC render`);
    for (const option of ref.selectOptions) {
      assert.ok(rendered.includes(option), `select option "${option}" for ${ref.refId} must not be truncated or dropped`);
    }
  }
});
```

Use exact current trace files, not synthetic benchmark-specific data.

- [ ] **Step 5.2: Run trace replay test**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/prc/prcTraceReplay.test.ts
```

Expected: pass or skip only when no local trace files exist.

## Task 6: Verification Gate

Run all focused checks:

```powershell
npx.cmd tsx --test tests/unit/v2/prc/plannerRepresentationCompiler.test.ts tests/unit/v2/prc/promptLayoutEngine.test.ts tests/unit/v2/prc/prcTraceReplay.test.ts tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/v2PlannerClient.test.ts
npm.cmd run build
npm.cmd run check:v2
```

Expected:

- All focused tests pass.
- Build passes.
- `check:v2` passes.
- Legacy JSON path remains default.
- PRC path is opt-in only.

## First Benchmark Gate After Implementation

Do not run broad `balanced30` first. Start with one MVR5 PRC smoke against JSON baseline:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-min-interval-ms 30000 --key-index 0
```

Then run the same slice with the PRC flag only after the CLI/env wiring exists. The comparison criteria are:

- Strict/manual quality must not regress materially.
- Trace complete rate must remain 100%.
- Invalid action and repeated action markers must not increase materially.
- Planner input tokens should drop substantially.

If quality regresses, keep PRC disabled and inspect trace differences. Do not tune against individual benchmark tasks.

## Self-Review

- This plan fixes the unsafe assumption that lane lists contain full element metadata.
- This plan preserves execution memory, failures, recovery, transition, uncertainty, answer feedback, lineage, regions, score tiers, action surface, and select options.
- This plan keeps PRC opt-in and leaves JSON default untouched.
- This plan avoids multi-syntax benchmarking, caching, Alumnium-style subagents, AX fallback, or broad architecture rewrite in v1.
- This plan has no benchmark-specific selectors, website-specific rules, or hardcoded task answers.
