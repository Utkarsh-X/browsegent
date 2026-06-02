# Planner Working Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BrowseGent v2's full-page planner ref dump with a graph-backed planner working set that is bounded, explainable, and production-grade.

**Architecture:** Add a `PlannerWorkingSetSelector` between Brain1 projection/Brain2 graph state and `PlannerInputComposer`. The selector emits selected refs, view summaries, inclusion/drop reason diagnostics, and a selected `current` projection so the planner sees high-signal operational state instead of every observed ref.

**Tech Stack:** TypeScript, Node `node:test`, existing BrowseGent v2 planner/graph/runtime modules, existing benchmark diagnostics pipeline.

---

## Scope

This plan implements the first architecture correction wave from `docs/superpowers/specs/2026-05-30-planner-working-set-design.md`.

Included:

- Planner working-set types.
- Graph-backed ref selection.
- Selected projection serialization.
- Planner input contract update.
- Planner prompt update.
- Benchmark diagnostics for working-set behavior.
- Runtime failure-classification correction for hidden/blocked errors currently mislabeled as timeout.

Excluded from this plan:

- Chrome accessibility-tree capture rewrite.
- Screenshot or vision model integration.
- New benchmark-specific heuristics.
- WebVoyager result tuning.
- Git commits unless the user explicitly asks.

## File Structure

Create:

```text
src/v2/planner/workingSetTypes.ts
src/v2/planner/PlannerWorkingSetSelector.ts
tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Modify:

```text
src/v2/planner/types.ts
src/v2/planner/PlannerInputComposer.ts
src/v2/planner/PlannerPrompt.ts
src/v2/planner/V2PlannerClient.ts
src/v2/index.ts
src/v2/substrate/InputService.ts
tests/benchmark/v2/types.ts
tests/benchmark/v2/diagnostics.ts
tests/benchmark/v2/report.ts
tests/unit/v2/plannerInputComposer.test.ts
tests/unit/v2/plannerPrompt.test.ts
tests/unit/v2/v2PlannerClient.test.ts
tests/unit/v2/benchmarkDiagnostics.test.ts
tests/unit/v2/benchmarkReport.test.ts
tests/unit/v2/providerSmokeRunner.test.ts
tests/eval/v2/run_provider_smoke.ts
```

## Task 1: Add Working-Set Types and Basic Selector

**Files:**

- Create: `src/v2/planner/workingSetTypes.ts`
- Create: `src/v2/planner/PlannerWorkingSetSelector.ts`
- Create: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

- [ ] **Step 1: Write failing selector tests**

Create `tests/unit/v2/plannerWorkingSetSelector.test.ts` with this structure:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_1',
    generationId: 1,
    targetId: 'target_1',
    selectorCandidates: ['#candidate'],
    role: 'button',
    name: 'Primary action',
    text: 'Primary action',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(refs: V2Ref[]): BrowserObservation {
  return buildBrowserObservation({
    observationId: 'obs_working_set',
    sessionId: 'session_working_set',
    generationId: 1,
    url: 'https://example.test',
    title: 'Working Set Fixture',
    timestamp: 1,
    durationMs: 5,
    refs,
    warnings: [],
  });
}

test('PlannerWorkingSetSelector keeps visible actionable refs and drops low-value hidden generics', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_submit', role: 'button', name: 'Submit order', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_hidden_generic', role: undefined, name: undefined, text: undefined, visibility: 'hidden', actionability: 'blocked' }),
    makeRef({ refId: 'ref_offscreen_generic', role: undefined, name: 'Decorative', text: 'Decorative', visibility: 'offscreen', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({
    maxPrimaryRefs: 4,
    maxSecondaryRefs: 4,
    maxReadableEvidence: 4,
    maxNavigationRefs: 4,
    maxRegionSummaries: 4,
  }).select({
    goal: 'Submit the order',
    projection,
  });

  assert.deepEqual(selection.selectedRefIds.sort(), ['ref_search', 'ref_submit']);
  assert.ok(selection.workingSet.primaryRefs.some(ref => ref.refId === 'ref_submit'));
  assert.ok(selection.workingSet.primaryRefs.some(ref => ref.reasons.includes('visible_ready')));
  assert.equal(selection.current.refs.ref_hidden_generic, undefined);
  assert.equal(selection.current.refs.ref_offscreen_generic, undefined);
  assert.equal(selection.diagnostics.observedRefCount, 4);
  assert.equal(selection.diagnostics.selectedRefCount, 2);
  assert.equal(selection.diagnostics.droppedRefCount, 2);
  assert.ok(selection.diagnostics.droppedByReason.hidden_low_value >= 1);
  assert.ok(selection.diagnostics.droppedByReason.offscreen_low_value >= 1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts
```

Expected:

```text
FAIL: Cannot find module '../../../src/v2/planner/PlannerWorkingSetSelector'
```

- [ ] **Step 3: Add working-set type definitions**

Create `src/v2/planner/workingSetTypes.ts`:

```ts
import type {
  ProjectionItemKind,
  SerializedProjection,
  SerializedProjectionRef,
} from '../brain1/projectionTypes';

export type WorkingSetMode = 'explore' | 'act' | 'verify' | 'recover' | 'extract' | 'done_candidate';

export type WorkingSetIncludeReason =
  | 'visible_ready'
  | 'goal_keyword_match'
  | 'role_relevant_to_goal'
  | 'near_focus'
  | 'recently_appeared'
  | 'recently_changed'
  | 'last_target'
  | 'last_success'
  | 'last_failure'
  | 'dead_state_evidence'
  | 'answer_candidate'
  | 'navigation_candidate'
  | 'form_candidate'
  | 'region_representative';

export type WorkingSetDropReason =
  | 'hidden_low_value'
  | 'offscreen_low_value'
  | 'generic_low_value'
  | 'duplicate_region_member'
  | 'navigation_overflow'
  | 'readable_overflow'
  | 'stale_unrelated'
  | 'low_confidence_unrelated'
  | 'token_budget_exceeded';

export interface PlannerWorkingSetOptions {
  maxPrimaryRefs?: number;
  maxSecondaryRefs?: number;
  maxReadableEvidence?: number;
  maxNavigationRefs?: number;
  maxRegionSummaries?: number;
  maxTextLengthPerRef?: number;
}

export interface PlannerWorkingSetRef {
  refId: string;
  kind: ProjectionItemKind;
  role?: string;
  name?: string;
  text?: string;
  score: number;
  reasons: WorkingSetIncludeReason[];
}

export interface PlannerWorkingSetEvidence {
  refId: string;
  text: string;
  reasons: WorkingSetIncludeReason[];
}

export interface PlannerWorkingSetRegionSummary {
  regionId: string;
  label: string;
  representativeRefs: string[];
  omittedRefCount: number;
}

export interface PlannerWorkingSetOmittedSummary {
  observedRefCount: number;
  selectedRefCount: number;
  droppedRefCount: number;
  droppedByReason: Partial<Record<WorkingSetDropReason, number>>;
}

export interface PlannerWorkingSet {
  mode: WorkingSetMode;
  modeReason: string;
  primaryRefs: PlannerWorkingSetRef[];
  secondaryRefs: PlannerWorkingSetRef[];
  readableEvidence: PlannerWorkingSetEvidence[];
  navigationRefs: PlannerWorkingSetRef[];
  changedRefs: PlannerWorkingSetRef[];
  failedRefs: PlannerWorkingSetRef[];
  regionSummaries: PlannerWorkingSetRegionSummary[];
  omitted: PlannerWorkingSetOmittedSummary;
}

export interface PlannerWorkingSetDiagnostics {
  observedRefCount: number;
  selectedRefCount: number;
  droppedRefCount: number;
  selectedByReason: Partial<Record<WorkingSetIncludeReason, number>>;
  droppedByReason: Partial<Record<WorkingSetDropReason, number>>;
  maxPrimaryRefs: number;
  maxSecondaryRefs: number;
  maxReadableEvidence: number;
  maxNavigationRefs: number;
  maxRegionSummaries: number;
}

export interface PlannerWorkingSetSelection {
  current: SerializedProjection;
  workingSet: PlannerWorkingSet;
  diagnostics: PlannerWorkingSetDiagnostics;
  selectedRefIds: string[];
}

export type WorkingSetSerializedRef = SerializedProjectionRef;
```

- [ ] **Step 4: Implement basic selector behavior**

Create `src/v2/planner/PlannerWorkingSetSelector.ts`:

```ts
import type { OperationalProjection, ProjectionItem, ProjectionRegion, SerializedProjection } from '../brain1/projectionTypes';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import type { TransitionEvidence, V2ToolResult } from '../runtime/types';
import type {
  PlannerWorkingSet,
  PlannerWorkingSetDiagnostics,
  PlannerWorkingSetEvidence,
  PlannerWorkingSetOptions,
  PlannerWorkingSetRef,
  PlannerWorkingSetRegionSummary,
  PlannerWorkingSetSelection,
  WorkingSetDropReason,
  WorkingSetIncludeReason,
  WorkingSetMode,
} from './workingSetTypes';

const DEFAULT_OPTIONS: Required<PlannerWorkingSetOptions> = {
  maxPrimaryRefs: 32,
  maxSecondaryRefs: 48,
  maxReadableEvidence: 48,
  maxNavigationRefs: 24,
  maxRegionSummaries: 12,
  maxTextLengthPerRef: 220,
};

export interface PlannerWorkingSetSelectorInput {
  goal: string;
  projection: OperationalProjection;
  graphSnapshot?: ContinuityGraphSnapshot;
  transitionEvidence?: TransitionEvidence;
  lastResult?: V2ToolResult;
  failureEvidence?: FailureEvidence[];
}

interface Candidate {
  item: ProjectionItem;
  score: number;
  reasons: Set<WorkingSetIncludeReason>;
  dropReason?: WorkingSetDropReason;
}

export class PlannerWorkingSetSelector {
  private readonly options: Required<PlannerWorkingSetOptions>;

  constructor(options: PlannerWorkingSetOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  select(input: PlannerWorkingSetSelectorInput): PlannerWorkingSetSelection {
    const candidates = input.projection.interactions.map(item => scoreCandidate(item, input.goal));
    const selected = candidates
      .filter(candidate => shouldKeepCandidate(candidate))
      .sort(compareCandidates);
    const dropped = candidates.filter(candidate => !shouldKeepCandidate(candidate));
    const selectedRefIds = selected
      .slice(0, this.options.maxPrimaryRefs + this.options.maxSecondaryRefs)
      .map(candidate => candidate.item.refId);
    const selectedSet = new Set(selectedRefIds);
    const primary = selected.slice(0, this.options.maxPrimaryRefs);
    const secondary = selected.slice(this.options.maxPrimaryRefs, this.options.maxPrimaryRefs + this.options.maxSecondaryRefs);
    const readableEvidence = buildReadableEvidence(input.projection, selectedSet, this.options);
    const navigationRefs = input.projection.navigation
      .filter(item => selectedSet.has(item.refId))
      .slice(0, this.options.maxNavigationRefs)
      .map(item => toWorkingSetRef(item, selected.find(candidate => candidate.item.refId === item.refId)?.reasons ?? new Set(['navigation_candidate'])));
    const regionSummaries = buildRegionSummaries(input.projection.regions, selectedSet, this.options.maxRegionSummaries);
    const diagnostics = buildDiagnostics(input.projection, selectedRefIds, selected, dropped, this.options);
    const current = serializeSelectedProjection(input.projection, selectedSet, this.options);

    return {
      current,
      selectedRefIds,
      diagnostics,
      workingSet: {
        mode: inferMode(input),
        modeReason: inferModeReason(input),
        primaryRefs: primary.map(candidate => toWorkingSetRef(candidate.item, candidate.reasons)),
        secondaryRefs: secondary.map(candidate => toWorkingSetRef(candidate.item, candidate.reasons)),
        readableEvidence,
        navigationRefs,
        changedRefs: [],
        failedRefs: [],
        regionSummaries,
        omitted: {
          observedRefCount: input.projection.stats.interactionCount,
          selectedRefCount: selectedRefIds.length,
          droppedRefCount: Math.max(0, input.projection.stats.interactionCount - selectedRefIds.length),
          droppedByReason: diagnostics.droppedByReason,
        },
      },
    };
  }
}

function scoreCandidate(item: ProjectionItem, goal: string): Candidate {
  const reasons = new Set<WorkingSetIncludeReason>();
  let score = item.score;
  if (item.visibility === 'visible' && item.actionability === 'ready') {
    reasons.add('visible_ready');
    score += 100;
  }
  if (goalMatchesItem(goal, item)) {
    reasons.add('goal_keyword_match');
    score += 60;
  }
  if (isGoalRelevantRole(goal, item)) {
    reasons.add('role_relevant_to_goal');
    score += 40;
  }
  if (item.kind === 'link') reasons.add('navigation_candidate');
  if (item.kind === 'input' || item.kind === 'select' || item.kind === 'editable') reasons.add('form_candidate');
  const dropReason = classifyLowValue(item);
  return { item, score, reasons, dropReason };
}

function shouldKeepCandidate(candidate: Candidate): boolean {
  return candidate.dropReason === undefined && candidate.reasons.size > 0;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.item.refId.localeCompare(right.item.refId);
}
```

Add the helper functions in the same file:

```ts
function classifyLowValue(item: ProjectionItem): WorkingSetDropReason | undefined {
  const hasText = Boolean(item.name?.trim() || item.text?.trim());
  if (item.visibility === 'hidden' && !hasText) return 'hidden_low_value';
  if (item.visibility === 'offscreen' && item.kind === 'generic') return 'offscreen_low_value';
  if (item.kind === 'generic' && !hasText) return 'generic_low_value';
  return undefined;
}

function goalTokens(goal: string): string[] {
  return goal.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3);
}

function goalMatchesItem(goal: string, item: ProjectionItem): boolean {
  const haystack = `${item.name ?? ''} ${item.text ?? ''} ${item.role ?? ''} ${item.kind}`.toLowerCase();
  return goalTokens(goal).some(token => haystack.includes(token));
}

function isGoalRelevantRole(goal: string, item: ProjectionItem): boolean {
  const normalized = goal.toLowerCase();
  if (/(search|find|look up|query)/.test(normalized) && item.kind === 'input') return true;
  if (/(open|go|navigate|visit)/.test(normalized) && item.kind === 'link') return true;
  if (/(submit|continue|save|apply|compute|calculate|sign in|login)/.test(normalized) && item.kind === 'button') return true;
  return false;
}

function toWorkingSetRef(item: ProjectionItem, reasons: Set<WorkingSetIncludeReason>): PlannerWorkingSetRef {
  return {
    refId: item.refId,
    kind: item.kind,
    role: item.role,
    name: item.name,
    text: compactOptionalText(item.text),
    score: item.score,
    reasons: [...reasons].sort(),
  };
}

function buildReadableEvidence(
  projection: OperationalProjection,
  selectedSet: Set<string>,
  options: Required<PlannerWorkingSetOptions>,
): PlannerWorkingSetEvidence[] {
  return projection.readables
    .filter(item => selectedSet.has(item.refId))
    .filter(item => Boolean(item.name?.trim() || item.text?.trim()))
    .slice(0, options.maxReadableEvidence)
    .map(item => ({
      refId: item.refId,
      text: compactText([item.name, item.text].filter(Boolean).join(' '), options.maxTextLengthPerRef),
      reasons: ['answer_candidate'],
    }));
}

function buildRegionSummaries(
  regions: ProjectionRegion[],
  selectedSet: Set<string>,
  maxRegionSummaries: number,
): PlannerWorkingSetRegionSummary[] {
  return regions
    .map(region => {
      const representativeRefs = region.refIds.filter(refId => selectedSet.has(refId)).slice(0, 3);
      return {
        regionId: region.regionId,
        label: region.label,
        representativeRefs,
        omittedRefCount: Math.max(0, region.refIds.length - representativeRefs.length),
      };
    })
    .filter(region => region.representativeRefs.length > 0)
    .slice(0, maxRegionSummaries);
}
```

Add the serializer and diagnostics helpers in the same file:

```ts
function serializeSelectedProjection(
  projection: OperationalProjection,
  selectedSet: Set<string>,
  options: Required<PlannerWorkingSetOptions>,
): SerializedProjection {
  const selectedItems = projection.interactions.filter(item => selectedSet.has(item.refId));
  const selectedRefs: SerializedProjection['refs'] = {};

  for (const item of selectedItems) {
    selectedRefs[item.refId] = {
      refId: item.refId,
      kind: item.kind,
      role: item.role,
      name: item.name,
      text: item.text && normalizeText(item.text) !== normalizeText(item.name) ? compactText(item.text, options.maxTextLengthPerRef) : undefined,
      visibility: item.visibility,
      actionability: item.actionability,
      state: item.state,
      confidence: item.continuityConfidence,
      score: item.score,
      regionId: item.regionId,
    };
  }

  return {
    projectionId: projection.projectionId,
    observationId: projection.observationId,
    generationId: projection.generationId,
    page: { url: projection.url, title: projection.title },
    focus: selectedItems[0] ? { refId: selectedItems[0].refId, reason: 'highest_operational_score' } : undefined,
    refs: selectedRefs,
    interactions: selectedItems.map((item, index) => ({ refId: item.refId, rank: index + 1 })),
    readables: projection.readables
      .filter(item => selectedSet.has(item.refId))
      .slice(0, options.maxReadableEvidence)
      .map((item, index) => ({ refId: item.refId, rank: index + 1 })),
    navigation: projection.navigation
      .filter(item => selectedSet.has(item.refId))
      .slice(0, options.maxNavigationRefs)
      .map((item, index) => ({ refId: item.refId, rank: index + 1 })),
    regions: projection.regions
      .map(region => ({ ...region, refIds: region.refIds.filter(refId => selectedSet.has(refId)) }))
      .filter(region => region.refIds.length > 0)
      .slice(0, options.maxRegionSummaries),
    warnings: projection.warnings,
    stats: {
      interactionCount: selectedItems.length,
      readableCount: projection.readables.filter(item => selectedSet.has(item.refId)).length,
      navigationCount: projection.navigation.filter(item => selectedSet.has(item.refId)).length,
      regionCount: projection.regions.filter(region => region.refIds.some(refId => selectedSet.has(refId))).length,
    },
  };
}

function buildDiagnostics(
  projection: OperationalProjection,
  selectedRefIds: string[],
  selected: Candidate[],
  dropped: Candidate[],
  options: Required<PlannerWorkingSetOptions>,
): PlannerWorkingSetDiagnostics {
  return {
    observedRefCount: projection.stats.interactionCount,
    selectedRefCount: selectedRefIds.length,
    droppedRefCount: Math.max(0, projection.stats.interactionCount - selectedRefIds.length),
    selectedByReason: countIncludeReasons(selected),
    droppedByReason: countDropReasons(dropped),
    maxPrimaryRefs: options.maxPrimaryRefs,
    maxSecondaryRefs: options.maxSecondaryRefs,
    maxReadableEvidence: options.maxReadableEvidence,
    maxNavigationRefs: options.maxNavigationRefs,
    maxRegionSummaries: options.maxRegionSummaries,
  };
}

function countIncludeReasons(candidates: Candidate[]): Partial<Record<WorkingSetIncludeReason, number>> {
  const counts: Partial<Record<WorkingSetIncludeReason, number>> = {};
  for (const candidate of candidates) {
    for (const reason of candidate.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function countDropReasons(candidates: Candidate[]): Partial<Record<WorkingSetDropReason, number>> {
  const counts: Partial<Record<WorkingSetDropReason, number>> = {};
  for (const candidate of candidates) {
    if (candidate.dropReason) counts[candidate.dropReason] = (counts[candidate.dropReason] ?? 0) + 1;
  }
  return counts;
}

function inferMode(input: PlannerWorkingSetSelectorInput): WorkingSetMode {
  if (input.failureEvidence?.length || input.lastResult?.error) return 'recover';
  if (input.lastResult?.success && input.lastResult.value !== undefined) return 'verify';
  if (/(extract|find|what|which|who|when|where|report)/i.test(input.goal)) return 'extract';
  return 'act';
}

function inferModeReason(input: PlannerWorkingSetSelectorInput): string {
  if (input.failureEvidence?.length || input.lastResult?.error) return 'recent_failure_evidence';
  if (input.lastResult?.success && input.lastResult.value !== undefined) return 'recent_value_evidence';
  if (/(extract|find|what|which|who|when|where|report)/i.test(input.goal)) return 'goal_requests_information';
  return 'default_action_mode';
}

function compactOptionalText(value: string | undefined): string | undefined {
  return value ? compactText(value, 220) : undefined;
}

function compactText(value: string, maxLength: number): string {
  const compacted = normalizeText(value);
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function normalizeText(value: string | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts
```

Expected:

```text
# pass 1
# fail 0
```

## Task 2: Add Goal-Relevance, Regions, and Budget Tests

**Files:**

- Modify: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`

- [ ] **Step 1: Add failing tests for goal relevance and bounded region summaries**

Append these tests to `tests/unit/v2/plannerWorkingSetSelector.test.ts`:

```ts
test('PlannerWorkingSetSelector promotes goal-matching refs over generic visible controls', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_docs', role: 'link', name: 'Documentation', text: 'Documentation', visibility: 'visible' }),
    makeRef({ refId: 'ref_pricing', role: 'link', name: 'Pricing', text: 'Pricing', visibility: 'visible' }),
    makeRef({ refId: 'ref_menu', role: 'button', name: 'Menu', text: 'Menu', visibility: 'visible' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 2, maxSecondaryRefs: 0 }).select({
    goal: 'Open the documentation',
    projection,
  });

  assert.equal(selection.workingSet.primaryRefs[0].refId, 'ref_docs');
  assert.ok(selection.workingSet.primaryRefs[0].reasons.includes('goal_keyword_match'));
});

test('PlannerWorkingSetSelector bounds dense repeated regions and reports omitted counts', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_open_1', role: 'button', name: 'Open', targetId: 'target_1', selectorCandidates: ['[data-testid="open-1"]'] }),
    makeRef({ refId: 'ref_open_2', role: 'button', name: 'Open', targetId: 'target_2', selectorCandidates: ['[data-testid="open-2"]'] }),
    makeRef({ refId: 'ref_open_3', role: 'button', name: 'Open', targetId: 'target_3', selectorCandidates: ['[data-testid="open-3"]'] }),
    makeRef({ refId: 'ref_open_4', role: 'button', name: 'Open', targetId: 'target_4', selectorCandidates: ['[data-testid="open-4"]'] }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 0, maxRegionSummaries: 1 }).select({
    goal: 'Open an item',
    projection,
  });

  assert.equal(selection.workingSet.regionSummaries.length, 1);
  assert.deepEqual(selection.workingSet.regionSummaries[0].representativeRefs, ['ref_open_1', 'ref_open_2', 'ref_open_3']);
  assert.equal(selection.workingSet.regionSummaries[0].omittedRefCount, 1);
});
```

- [ ] **Step 2: Run focused tests and verify the new assertions fail if ordering or region summaries are incomplete**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts
```

Expected before implementation adjustment:

```text
FAIL if ref_docs is not first or region omitted count is incorrect
```

- [ ] **Step 3: Adjust selector ranking and region ordering**

In `PlannerWorkingSetSelector.ts`, update `toWorkingSetRef` so it uses the candidate's final score, not only the projection item's original score:

```ts
function toWorkingSetRef(item: ProjectionItem, reasons: Set<WorkingSetIncludeReason>, score = item.score): PlannerWorkingSetRef {
  return {
    refId: item.refId,
    kind: item.kind,
    role: item.role,
    name: item.name,
    text: compactOptionalText(item.text),
    score,
    reasons: [...reasons].sort(),
  };
}
```

Update the mappings:

```ts
primaryRefs: primary.map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
secondaryRefs: secondary.map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
```

Update region summary ordering so representatives preserve original region order:

```ts
const representativeRefs = region.refIds.filter(refId => selectedSet.has(refId)).slice(0, 3);
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts
```

Expected:

```text
# fail 0
```

## Task 3: Add Graph, Failure, and Last-Result Selection

**Files:**

- Modify: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`

- [ ] **Step 1: Add failing tests for transition and failure evidence**

Append:

```ts
test('PlannerWorkingSetSelector keeps recently appeared refs from transition evidence', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_old', role: 'button', name: 'Old action', visibility: 'visible' }),
    makeRef({ refId: 'ref_new', role: 'button', name: 'New result action', visibility: 'offscreen' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Continue after the page changed',
    projection,
    transitionEvidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_new'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_old'],
      },
      notes: [],
    },
  });

  const newRef = [...selection.workingSet.primaryRefs, ...selection.workingSet.secondaryRefs].find(ref => ref.refId === 'ref_new');
  assert.ok(newRef);
  assert.ok(newRef.reasons.includes('recently_appeared'));
});

test('PlannerWorkingSetSelector keeps failed target refs with failure reasons for recovery', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible' }),
    makeRef({ refId: 'ref_submit', role: 'button', name: 'Search', visibility: 'hidden', actionability: 'blocked' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Search for quantum computing',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_submit',
      error: { code: 'target_hidden', message: 'Target was hidden.', retryable: false },
      traceStepId: 'step_click_submit',
    },
    failureEvidence: [{
      failureId: 'failure_target_hidden_ref_submit',
      kind: 'target_hidden',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target ref is hidden at execution time.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_submit',
      signals: ['error:target_hidden'],
    }],
  });

  assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_submit'));
  assert.ok(selection.selectedRefIds.includes('ref_submit'));
  assert.equal(selection.workingSet.mode, 'recover');
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts
```

Expected:

```text
FAIL for missing recently_appeared or failedRefs behavior
```

- [ ] **Step 3: Implement evidence-aware candidate augmentation**

In `PlannerWorkingSetSelector.ts`, add evidence sets inside `select()` before scoring:

```ts
const appearedRefs = new Set(input.transitionEvidence?.refChanges.appeared ?? []);
const changedRefs = new Set([
  ...(input.transitionEvidence?.refChanges.appeared ?? []),
  ...(input.transitionEvidence?.refChanges.weakened ?? []),
]);
const failedRefs = new Set([
  ...(input.failureEvidence ?? []).map(failure => failure.targetRef).filter((refId): refId is string => Boolean(refId)),
  input.lastResult?.success === false ? input.lastResult.targetRef : undefined,
].filter((refId): refId is string => Boolean(refId)));
```

Change `scoreCandidate` signature:

```ts
function scoreCandidate(
  item: ProjectionItem,
  goal: string,
  evidence: { appearedRefs: Set<string>; changedRefs: Set<string>; failedRefs: Set<string> },
): Candidate {
```

Add evidence scoring:

```ts
if (evidence.appearedRefs.has(item.refId)) {
  reasons.add('recently_appeared');
  score += 90;
}
if (evidence.changedRefs.has(item.refId)) {
  reasons.add('recently_changed');
  score += 70;
}
if (evidence.failedRefs.has(item.refId)) {
  reasons.add('last_failure');
  score += 80;
}
```

Allow failed/changed refs to bypass low-value drops:

```ts
const lowValueReason = classifyLowValue(item);
const dropReason = evidence.failedRefs.has(item.refId) || evidence.changedRefs.has(item.refId)
  ? undefined
  : lowValueReason;
```

Build `changedRefs` and `failedRefs` arrays in the returned working set:

```ts
changedRefs: selected
  .filter(candidate => candidate.reasons.has('recently_appeared') || candidate.reasons.has('recently_changed'))
  .map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
failedRefs: selected
  .filter(candidate => candidate.reasons.has('last_failure'))
  .map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts
```

Expected:

```text
# fail 0
```

## Task 4: Integrate Working Set Into Planner Input Composer

**Files:**

- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/planner/PlannerInputComposer.ts`
- Modify: `src/v2/index.ts`
- Modify: `tests/unit/v2/plannerInputComposer.test.ts`
- Modify: `tests/unit/v2/providerSmokeRunner.test.ts`
- Modify: `tests/eval/v2/run_provider_smoke.ts`

- [ ] **Step 1: Add failing planner input tests**

Append to `tests/unit/v2/plannerInputComposer.test.ts`:

```ts
test('PlannerInputComposer emits bounded working set instead of full projection refs', () => {
  const refs = Array.from({ length: 80 }, (_, index) => makeRef({
    refId: `ref_hidden_${index}`,
    targetId: `target_hidden_${index}`,
    role: undefined,
    name: undefined,
    text: undefined,
    visibility: 'hidden',
    actionability: 'blocked',
  }));
  refs.push(makeRef({
    refId: 'ref_search',
    targetId: 'target_search',
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    visibility: 'visible',
    actionability: 'ready',
  }));

  const projection = new ProjectionService().project(makeObservation({
    observationId: 'obs_bounded_working_set',
    refs,
  }));

  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_bounded_working_set',
    goal: 'Search for docs',
    projection,
  });

  assert.equal(input.version, 'v2.planner_input.v2');
  assert.ok(input.workingSet);
  assert.ok(input.workingSetDiagnostics);
  assert.equal(Object.keys(input.current.refs).includes('ref_search'), true);
  assert.equal(Object.keys(input.current.refs).some(refId => refId.startsWith('ref_hidden_')), false);
  assert.equal(input.workingSetDiagnostics.observedRefCount, 81);
  assert.equal(input.workingSetDiagnostics.selectedRefCount, 1);
  assert.ok(input.workingSetDiagnostics.droppedByReason.hidden_low_value >= 80);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerInputComposer.test.ts
```

Expected:

```text
FAIL because PlannerInput has no workingSet fields and version is still v1
```

- [ ] **Step 3: Update planner input types**

Modify `src/v2/planner/types.ts`:

```ts
import type {
  PlannerWorkingSet,
  PlannerWorkingSetDiagnostics,
} from './workingSetTypes';
```

Change the version type:

```ts
export type PlannerInputVersion = 'v2.planner_input.v1' | 'v2.planner_input.v2';
```

Update `PlannerInput`:

```ts
export interface PlannerInput {
  version: PlannerInputVersion;
  episodeId: string;
  goal: string;
  current: SerializedProjection;
  workingSet?: PlannerWorkingSet;
  workingSetDiagnostics?: PlannerWorkingSetDiagnostics;
  continuity?: PlannerContinuitySummary;
  transition?: PlannerTransitionSummary;
  lastResult?: PlannerLastResultSummary;
  failures?: PlannerFailureSummary[];
  deadState?: PlannerDeadStateSummary;
  uncertainty: PlannerUncertainty;
  lineage?: CompressedLineage;
}
```

- [ ] **Step 4: Use selector in composer**

Modify imports in `src/v2/planner/PlannerInputComposer.ts`:

```ts
import { PlannerWorkingSetSelector } from './PlannerWorkingSetSelector';
```

Add a private selector:

```ts
private readonly workingSetSelector = new PlannerWorkingSetSelector();
```

Replace:

```ts
const current = serializeProjection(input.projection);
```

with:

```ts
const workingSetSelection = this.workingSetSelector.select({
  goal: input.goal,
  projection: input.projection,
  graphSnapshot: input.graphSnapshot,
  transitionEvidence: input.transitionEvidence,
  lastResult: input.lastResult,
  failureEvidence: input.failureEvidence,
});
const current = workingSetSelection.current;
```

Return version and new fields:

```ts
version: 'v2.planner_input.v2',
workingSet: workingSetSelection.workingSet,
workingSetDiagnostics: workingSetSelection.diagnostics,
```

Remove the unused `serializeProjection` import after composer no longer uses it.

- [ ] **Step 5: Export new types**

Modify `src/v2/index.ts`:

```ts
export { PlannerWorkingSetSelector } from './planner/PlannerWorkingSetSelector';
export type {
  PlannerWorkingSet,
  PlannerWorkingSetDiagnostics,
  PlannerWorkingSetEvidence,
  PlannerWorkingSetOptions,
  PlannerWorkingSetRef,
  PlannerWorkingSetRegionSummary,
  PlannerWorkingSetSelection,
  WorkingSetDropReason,
  WorkingSetIncludeReason,
  WorkingSetMode,
} from './planner/workingSetTypes';
```

Also export `PlannerInputVersion` from `./planner/types`.

- [ ] **Step 6: Update fixtures that hard-code planner input version**

Change fixture objects in these files from:

```ts
version: 'v2.planner_input.v1',
```

to:

```ts
version: 'v2.planner_input.v2',
```

Files:

```text
tests/unit/v2/providerSmokeRunner.test.ts
tests/eval/v2/run_provider_smoke.ts
tests/unit/v2/v2PlannerClient.test.ts
```

Where fixture tests need `workingSet`, add:

```ts
workingSet: {
  mode: 'act',
  modeReason: 'fixture',
  primaryRefs: [],
  secondaryRefs: [],
  readableEvidence: [],
  navigationRefs: [],
  changedRefs: [],
  failedRefs: [],
  regionSummaries: [],
  omitted: { observedRefCount: 0, selectedRefCount: 0, droppedRefCount: 0, droppedByReason: {} },
},
workingSetDiagnostics: {
  observedRefCount: 0,
  selectedRefCount: 0,
  droppedRefCount: 0,
  selectedByReason: {},
  droppedByReason: {},
  maxPrimaryRefs: 32,
  maxSecondaryRefs: 48,
  maxReadableEvidence: 48,
  maxNavigationRefs: 24,
  maxRegionSummaries: 12,
},
```

- [ ] **Step 7: Run planner-focused unit tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerInputComposer.test.ts tests\unit\v2\v2PlannerClient.test.ts tests\unit\v2\providerSmokeRunner.test.ts
```

Expected:

```text
# fail 0
```

## Task 5: Update Planner Prompt and Compact User Serialization

**Files:**

- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`

- [ ] **Step 1: Add prompt tests for working-set contract and compact serialization**

Modify `tests/unit/v2/plannerPrompt.test.ts`:

```ts
import {
  buildV2PlannerSystemPrompt,
  buildV2PlannerUserMessage,
} from '../../../src/v2/planner/PlannerPrompt';
```

Append:

```ts
test('buildV2PlannerSystemPrompt describes working set and targeted expansion', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /workingSet/i);
  assert.match(prompt, /selected refs/i);
  assert.match(prompt, /Do not assume omitted refs are unavailable/i);
  assert.match(prompt, /inspect_region/i);
  assert.match(prompt, /search_page/i);
});

test('buildV2PlannerUserMessage serializes planner input compactly', () => {
  const message = buildV2PlannerUserMessage({
    version: 'v2.planner_input.v2',
    episodeId: 'episode_prompt_compact',
    goal: 'Open docs',
    current: {
      projectionId: 'projection_1',
      observationId: 'obs_1',
      generationId: 1,
      page: { url: 'https://example.test', title: 'Example' },
      refs: {},
      interactions: [],
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: 0, readableCount: 0, navigationCount: 0, regionCount: 0 },
    },
    uncertainty: { level: 'none', signals: [] },
  });

  assert.match(message, /^Planner input JSON:\n\{/);
  assert.doesNotMatch(message, /\n  "/);
});
```

- [ ] **Step 2: Run prompt test and verify failure**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerPrompt.test.ts
```

Expected:

```text
FAIL until prompt text and compact JSON are updated
```

- [ ] **Step 3: Update system prompt**

In `src/v2/planner/PlannerPrompt.ts`, replace the planner input shape paragraph:

```ts
Planner input shape: current.refs contains selected ref facts only. workingSet explains why refs were included, what was omitted, and which compact evidence is currently available. interactions, readables, navigation, and regions are bounded views over selected refs, not the full page.

Do not assume omitted refs are unavailable. If the selected working set is insufficient, use get, inspect_region, search_page, scroll, wait, or navigation actions to gather more evidence. Prefer targeted expansion over repeating the same failed action.
```

Keep existing instructions for finishing from `lastResult.valuePreview` and operational failure reporting.

- [ ] **Step 4: Compact planner user message**

Change:

```ts
${JSON.stringify(input, null, 2)}
```

to:

```ts
${JSON.stringify(input)}
```

- [ ] **Step 5: Run prompt tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerPrompt.test.ts
```

Expected:

```text
# fail 0
```

## Task 6: Update Planner Validation Context for Selected Refs

**Files:**

- Modify: `src/v2/planner/V2PlannerClient.ts`
- Modify: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 1: Add failing validation test for working-set refs**

Append to `tests/unit/v2/v2PlannerClient.test.ts`:

```ts
test('V2PlannerClient validation accepts refs selected through working set current refs only', async () => {
  const plannerInput = makePlannerInput('episode_working_set_refs');
  plannerInput.version = 'v2.planner_input.v2';
  plannerInput.current.refs = {
    ref_visible: {
      refId: 'ref_visible',
      kind: 'button',
      role: 'button',
      name: 'Visible action',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 100,
    },
  };
  plannerInput.current.interactions = [{ refId: 'ref_visible', rank: 1 }];
  plannerInput.current.readables = [];
  plannerInput.current.navigation = [];

  const client = new V2PlannerClient({
    provider: async () => ({
      text: JSON.stringify({ plan: [{ tool: 'click', ref: 'ref_hidden_omitted' }], confidence: 'high' }),
      inputTokens: 1,
      outputTokens: 1,
    }),
  });

  await assert.rejects(
    () => client.call({ plannerInput }),
    /ref_hidden_omitted/,
  );
});
```

- [ ] **Step 2: Run client test and inspect current behavior**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\v2PlannerClient.test.ts
```

Expected:

```text
The test should pass if validation already rejects omitted refs. If it fails, collectValidationContext is too permissive.
```

- [ ] **Step 3: Tighten region ref collection if needed**

If omitted refs can enter through `current.regions`, modify `collectValidationContext()` in `V2PlannerClient.ts` so region refs are accepted only when also present in `input.current.refs`:

```ts
const currentRefs = new Set(Object.keys(input.current.refs ?? {}));
for (const refId of currentRefs) refs.add(refId);

for (const region of input.current.regions) {
  const selectedRegionRefs = region.refIds.filter(refId => currentRefs.has(refId));
  if (selectedRegionRefs[0]) {
    regionRefs[region.regionId] = selectedRegionRefs[0];
  }
  for (const refId of selectedRegionRefs) refs.add(refId);
}
```

- [ ] **Step 4: Run client tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\v2PlannerClient.test.ts
```

Expected:

```text
# fail 0
```

## Task 7: Add Benchmark Diagnostics for Working Set

**Files:**

- Modify: `tests/benchmark/v2/types.ts`
- Modify: `tests/benchmark/v2/diagnostics.ts`
- Modify: `tests/benchmark/v2/report.ts`
- Modify: `tests/unit/v2/benchmarkDiagnostics.test.ts`
- Modify: `tests/unit/v2/benchmarkReport.test.ts`

- [ ] **Step 1: Add failing diagnostics tests**

In `tests/unit/v2/benchmarkDiagnostics.test.ts`, extend the planner input fixture in `collectBenchmarkDiagnostics summarizes trace payload sizes and action markers` with:

```ts
workingSet: {
  primaryRefs: [{ refId: 'ref_a', reasons: ['visible_ready'] }],
  secondaryRefs: [],
  readableEvidence: [],
  navigationRefs: [],
  changedRefs: [],
  failedRefs: [],
  regionSummaries: [],
  omitted: {
    observedRefCount: 10,
    selectedRefCount: 1,
    droppedRefCount: 9,
    droppedByReason: { hidden_low_value: 9 },
  },
},
workingSetDiagnostics: {
  observedRefCount: 10,
  selectedRefCount: 1,
  droppedRefCount: 9,
  selectedByReason: { visible_ready: 1 },
  droppedByReason: { hidden_low_value: 9 },
  maxPrimaryRefs: 32,
  maxSecondaryRefs: 48,
  maxReadableEvidence: 48,
  maxNavigationRefs: 24,
  maxRegionSummaries: 12,
},
```

Add assertions:

```ts
assert.equal(diagnostics.workingSet.maxObservedRefs, 10);
assert.equal(diagnostics.workingSet.maxSelectedRefs, 1);
assert.equal(diagnostics.workingSet.maxDroppedRefs, 9);
assert.equal(diagnostics.workingSet.selectedByReason.visible_ready, 1);
assert.equal(diagnostics.workingSet.droppedByReason.hidden_low_value, 9);
```

- [ ] **Step 2: Run diagnostics test and verify it fails**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\benchmarkDiagnostics.test.ts
```

Expected:

```text
FAIL because BenchmarkDiagnostics has no workingSet field
```

- [ ] **Step 3: Extend benchmark diagnostics types**

In `tests/benchmark/v2/types.ts`, add:

```ts
export interface BenchmarkWorkingSetDiagnostics {
  maxObservedRefs: number;
  maxSelectedRefs: number;
  maxDroppedRefs: number;
  selectedByReason: Record<string, number>;
  droppedByReason: Record<string, number>;
}
```

Update `BenchmarkDiagnostics`:

```ts
workingSet: BenchmarkWorkingSetDiagnostics;
```

Update `BenchmarkDiagnosticsSummary`:

```ts
maxWorkingSetObservedRefs: number;
maxWorkingSetSelectedRefs: number;
maxWorkingSetDroppedRefs: number;
```

- [ ] **Step 4: Collect working-set diagnostics from planner input artifacts**

In `tests/benchmark/v2/diagnostics.ts`, add a `summarizeWorkingSetDiagnostics()` function:

```ts
async function summarizeWorkingSetDiagnostics(
  tracePath: string,
  artifacts: TraceArtifact[],
  warnings: string[],
): Promise<BenchmarkWorkingSetDiagnostics> {
  const summary = emptyWorkingSetDiagnostics();

  for (const artifact of artifacts) {
    const artifactPath = resolveArtifactPath(tracePath, artifact.path);
    let input: unknown;
    try {
      input = JSON.parse(await readFile(artifactPath, 'utf8'));
    } catch (error) {
      warnings.push(`working_set_diagnostics_unavailable:${artifact.id}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const diagnostics = section(input, 'workingSetDiagnostics');
    if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) continue;
    const record = diagnostics as Record<string, unknown>;
    const observed = numberField(record, 'observedRefCount');
    const selected = numberField(record, 'selectedRefCount');
    const dropped = numberField(record, 'droppedRefCount');

    summary.maxObservedRefs = Math.max(summary.maxObservedRefs, observed);
    summary.maxSelectedRefs = Math.max(summary.maxSelectedRefs, selected);
    summary.maxDroppedRefs = Math.max(summary.maxDroppedRefs, dropped);
    mergeCounts(summary.selectedByReason, section(record, 'selectedByReason'));
    mergeCounts(summary.droppedByReason, section(record, 'droppedByReason'));
  }

  return summary;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function mergeCounts(target: Record<string, number>, source: unknown): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[key] = (target[key] ?? 0) + value;
    }
  }
}

function emptyWorkingSetDiagnostics(): BenchmarkWorkingSetDiagnostics {
  return {
    maxObservedRefs: 0,
    maxSelectedRefs: 0,
    maxDroppedRefs: 0,
    selectedByReason: {},
    droppedByReason: {},
  };
}
```

Call it inside `collectTraceDiagnostics()`:

```ts
diagnostics.workingSet = await summarizeWorkingSetDiagnostics(
  tracePath,
  manifest.artifacts.planner.filter(artifact => artifact.kind === 'planner_input'),
  diagnostics.warnings,
);
```

Initialize it inside `emptyDiagnostics()`:

```ts
workingSet: emptyWorkingSetDiagnostics(),
```

- [ ] **Step 5: Aggregate report summary**

In `tests/benchmark/v2/report.ts`, update diagnostics summary aggregation:

```ts
maxWorkingSetObservedRefs: max(results.map(result => result.diagnostics?.workingSet.maxObservedRefs ?? 0)),
maxWorkingSetSelectedRefs: max(results.map(result => result.diagnostics?.workingSet.maxSelectedRefs ?? 0)),
maxWorkingSetDroppedRefs: max(results.map(result => result.diagnostics?.workingSet.maxDroppedRefs ?? 0)),
```

Update report tests to assert these fields.

- [ ] **Step 6: Run diagnostics and report tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\benchmarkDiagnostics.test.ts tests\unit\v2\benchmarkReport.test.ts
```

Expected:

```text
# fail 0
```

## Task 8: Correct Runtime Error Classification Ordering

**Files:**

- Modify: `src/v2/substrate/InputService.ts`
- Modify: `tests/unit/v2/inputService.test.ts` if present
- Create: `tests/unit/v2/inputServiceErrorMapping.test.ts` if no existing InputService unit test exists

- [ ] **Step 1: Check for existing InputService tests**

Run:

```powershell
rg -n "InputService|target_hidden|mapPlaywrightError" tests\unit\v2 tests\unit
```

Expected:

```text
Existing tests are listed, or no matches are returned.
```

- [ ] **Step 2: Add failing test for timeout plus not-visible message**

If no focused file exists, create `tests/unit/v2/inputServiceErrorMapping.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { InputService } from '../../../src/v2/substrate/InputService';
import type { V2Ref } from '../../../src/v2';

function makeRef(): V2Ref {
  return {
    refId: 'ref_hidden_button',
    generationId: 1,
    targetId: 'target_hidden_button',
    selectorCandidates: ['#hidden-button'],
    role: 'button',
    name: 'Hidden',
    text: 'Hidden',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
  };
}

test('InputService maps Playwright timeout with not visible details to target_hidden', async () => {
  const locator = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => undefined,
    evaluate: async () => false,
    click: async () => {
      throw new Error('Timeout 1500ms exceeded. element is not visible');
    },
  };
  const page = {
    locator: () => ({ first: () => locator }),
  };

  await assert.rejects(
    () => new InputService().click(makeRef(), page as never),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, 'target_hidden');
      return true;
    },
  );
});
```

- [ ] **Step 3: Run focused test and verify failure**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\inputServiceErrorMapping.test.ts
```

Expected:

```text
FAIL because mapPlaywrightError checks timeout before not visible
```

- [ ] **Step 4: Reorder error mapping**

In `src/v2/substrate/InputService.ts`, change `mapPlaywrightError()` ordering:

```ts
if (lowered.includes('not visible') || lowered.includes('hidden')) {
  return new V2OperationalError('target_hidden', `Target was not visible during ${action}.`, { retryable: false });
}

if (lowered.includes('disabled')) {
  return new V2OperationalError('target_disabled', `Target was disabled during ${action}.`, { retryable: false });
}

if (lowered.includes('intercepts pointer events') || lowered.includes('not receive pointer events')) {
  return new V2OperationalError('target_blocked', `Target was blocked during ${action}.`, { retryable: false });
}

if (lowered.includes('timeout')) {
  return new V2OperationalError('timeout', `${action} timed out before the target became stable.`, { retryable: true });
}
```

- [ ] **Step 5: Run focused test**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\inputServiceErrorMapping.test.ts
```

Expected:

```text
# fail 0
```

## Task 9: Update Existing Tests Affected by Selected Projection Semantics

**Files:**

- Modify: `tests/unit/v2/brain1Projection.test.ts`
- Modify: `tests/unit/v2/plannerInputComposer.test.ts`
- Modify: `tests/unit/v2/deadStateEvidence.test.ts`

- [ ] **Step 1: Run the v2 unit subset to discover legitimate expectation changes**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\*.test.ts
```

Expected:

```text
Some tests may fail because they assume current.refs contains every ref.
```

- [ ] **Step 2: Preserve Brain1 projection tests that are still true**

Do not change `serializeProjection` unit tests unless the implementation intentionally changes `serializeProjection`. The first architecture correction should leave raw projection serialization available for diagnostics and direct unit coverage.

- [ ] **Step 3: Update planner composer assertions to selected-context semantics**

Where `PlannerInputComposer` tests assert full ref inclusion, replace with selected ref assertions:

```ts
assert.ok(Object.keys(input.current.refs).length <= input.workingSetDiagnostics!.selectedRefCount);
assert.ok(input.workingSet!.primaryRefs.length + input.workingSet!.secondaryRefs.length > 0);
assert.doesNotMatch(JSON.stringify(input), /selectorCandidates/);
assert.doesNotMatch(JSON.stringify(input), /backendNodeId/);
```

- [ ] **Step 4: Keep operational evidence tests intact**

Tests for `lastResult`, `failures`, `deadState`, `uncertainty`, and `lineage` should continue to pass. If a test fails only because version changed, update expected version to:

```ts
'v2.planner_input.v2'
```

- [ ] **Step 5: Re-run v2 unit subset**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\*.test.ts
```

Expected:

```text
# fail 0
```

## Task 10: Full Verification Gate

**Files:**

- No code changes in this task.

- [ ] **Step 1: Run all unit tests**

Run:

```powershell
npm.cmd run test:unit
```

Expected:

```text
All unit tests pass.
```

- [ ] **Step 2: Run TypeScript build**

Run:

```powershell
npm.cmd run build
```

Expected:

```text
tsc --noEmit completes with exit code 0.
```

- [ ] **Step 3: Run v2 governance checks**

Run:

```powershell
npm.cmd run check:v2
```

Expected:

```text
Boundary and no-cognition-leakage checks pass.
```

- [ ] **Step 4: Run whitespace diff check**

Run:

```powershell
git diff --check
```

Expected:

```text
No whitespace errors. CRLF warnings are acceptable only if they already exist and are not introduced by these changes.
```

- [ ] **Step 5: Run one local non-benchmark smoke if unit gates pass**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\v2AgentLoop.test.ts
```

Expected:

```text
All V2AgentLoop unit tests pass.
```

## Task 11: Controlled Five-Task Benchmark Smoke

**Files:**

- No source changes in this task.

- [ ] **Step 1: Run only after Task 10 passes**

Do not run this benchmark if unit/build/governance checks fail.

- [ ] **Step 2: Run BrowseGent five-task smoke**

Use the model name confirmed by the user:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root C:\tmp\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 4
```

Expected:

```text
Benchmark completes and writes a report under logs/webvoyager-lite.
```

- [ ] **Step 3: Inspect architecture metrics, not only pass rate**

Run:

```powershell
Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Recurse -Filter "report.json" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  ForEach-Object {
    Get-Content $_.FullName | ConvertFrom-Json |
      Select-Object -ExpandProperty summary |
      ConvertTo-Json -Depth 8
  }
```

Expected review points:

```text
maxPlannerInputBytes lower than previous full-ref runs
maxProjectionBytes lower than previous full-ref runs
maxWorkingSetSelectedRefs present
maxWorkingSetDroppedRefs present
no trace replay failures
failure types remain explainable
```

- [ ] **Step 4: Do not tune from benchmark failures**

If benchmark failures occur, classify them into architecture-general categories:

```text
environment_block
rate_limit
missing_semantic_evidence
action_resolution_failure
loop_or_no_progress
visual_evidence_required
reference_or_evaluator_mismatch
```

Do not add website-specific or task-specific rules.

## Self-Review Checklist

- [ ] Spec coverage: Tasks 1-7 implement working-set contract, graph/evidence selection, planner integration, prompt update, validation, and diagnostics.
- [ ] Runtime coverage: Task 8 fixes a known general runtime classification bug exposed during trace analysis.
- [ ] Verification coverage: Tasks 10-11 require unit, build, governance, diff, loop tests, and a controlled five-task benchmark smoke.
- [ ] Non-goal compliance: No AX rewrite, no always-on screenshots, no benchmark-specific tuning.
- [ ] Git compliance: This plan does not require commits because the user asked to avoid unnecessary git work.

## Execution Handoff

Plan complete. Two execution options:

```text
1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fastest safe iteration.
2. Inline Execution: execute tasks in this session using executing-plans, with checkpoints after each task group.
```

Use option 1 if the environment supports subagents. Use option 2 if subagent tools are unavailable or if preserving local context is more important than parallelism.
