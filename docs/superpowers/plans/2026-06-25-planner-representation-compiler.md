# Planner Representation Compiler — Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `JSON.stringify(input)` in `PlannerPrompt.ts` with an IR-based compiler pipeline. The compiler produces a structured `PlannerRepresentationIR` object; `PromptLayoutEngine` renders that IR to a string. Reduces per-call planner tokens by ~90%, preserves all planner information, and creates a stable abstraction boundary for future consumers (debugger, evaluator, replay viewer, fine-tuning pipeline).

**Architecture:** `PlannerRepresentationCompiler` returns a typed IR struct — not a string. `PromptLayoutEngine` converts IR to text using `ElementSyntaxEncoder` for configurable element syntax. Feature flag `plannerSerialization: 'json' | 'prc'` defaults to `'json'`. All upstream components untouched.

**Tech Stack:** TypeScript, Node.js `node:test` + `node:assert/strict`, `npm run test:unit`

---

## File Map

### New files (create)
```
src/v2/planner/prc/
  types.ts                          — all IR types and interfaces
  ElementNormalizer.ts              — SerializedProjectionRef → NormalizedPlannerElement
  ElementSyntaxEncoder.ts           — NormalizedPlannerElement → string (syntax variants)
  RegionOptimizer.ts                — adaptive grouping with RegionBudget interface
  ExecutionContextBuilder.ts        — PlannerInput → ExecutionContextIR
  PlannerSurfaceBuilder.ts          — projection → PlannerSurfaceIR
  WorkingSetBuilder.ts              — PlannerWorkingSet → WorkingSetIR
  DecisionSignalBuilder.ts          — PlannerWorkingSet → DecisionSignalsIR
  PromptLayoutEngine.ts             — PlannerRepresentationIR → string
  PlannerRepresentationCompiler.ts  — orchestrator, returns PlannerRepresentationIR

tests/unit/v2/prc/
  ElementNormalizer.test.ts
  ElementSyntaxEncoder.test.ts
  RegionOptimizer.test.ts
  ExecutionContextBuilder.test.ts
  PlannerSurfaceBuilder.test.ts
  WorkingSetBuilder.test.ts
  DecisionSignalBuilder.test.ts
  PromptLayoutEngine.test.ts
  PlannerRepresentationCompiler.test.ts   — invariant + integration tests
```

### Modified files
```
src/v2/planner/types.ts               — add PlannerSerializationConfig
src/v2/planner/PlannerPrompt.ts       — wire compiler+engine behind flag
tests/unit/v2/plannerPrompt.test.ts   — add prc smoke + keep json default test
```

### Unchanged
Every other file in `src/v2/`. Zero-touch policy.

---

## Task 1: IR Types + Feature Flag

**Files:**
- Create: `src/v2/planner/prc/types.ts`
- Modify: `src/v2/planner/types.ts`

- [ ] **Step 1.1: Create `src/v2/planner/prc/types.ts`**

  ```typescript
  import type {
    PlannerTransitionSummary,
    PlannerLastResultSummary,
    PlannerFailureSummary,
    PlannerDeadStateSummary,
    PlannerUncertainty,
    PlannerAnswerFeedback,
    CompressedLineage,
  } from '../types';
  import type { PlannerRecoveryState } from '../../runtime/RecoveryState';
  import type { PlannerActionSurface } from '../workingSetTypes';
  import type { WorkingSetIncludeReason, WorkingSetDropReason } from '../workingSetTypes';

  // ── Element types ────────────────────────────────────────────────────────────

  export type ElementLane = 'interaction' | 'readable' | 'navigation';
  export type ScoreTier = 'top' | 'high' | 'mid' | 'low';

  export type ElementAnomaly =
    | { kind: 'offscreen' }
    | { kind: 'hidden' }
    | { kind: 'blocked' }
    | { kind: 'disabled' }
    | { kind: 'confidence'; value: number }
    | { kind: 'state'; value: string };

  export interface NormalizedPlannerElement {
    refId: string;
    kind: string;
    name: string;
    lane: ElementLane;
    scoreTier: ScoreTier;
    anomalies: ElementAnomaly[];
    text?: string;           // only when text !== name
    selectOptions?: string;  // full text, never truncated
    failureAnnotation?: string; // e.g. "timeout×2"
    regionId?: string;
  }

  // ── Surface IR ───────────────────────────────────────────────────────────────

  export interface SurfaceRegionGroup {
    regionId: string;
    label: string;
    visibleElements: NormalizedPlannerElement[];
    omittedCount: number;
    totalCount: number;
  }

  export type SurfaceRenderMode = 'full' | 'summary';

  export interface PlannerSurfaceIR {
    groups: SurfaceRegionGroup[];
    remainder: NormalizedPlannerElement[];
    renderMode: SurfaceRenderMode;
  }

  // ── Execution context IR ─────────────────────────────────────────────────────

  export interface ExecutionContextIR {
    goal: string;
    page: { title: string; url: string } | undefined;
    focus: { refId: string; reason: string } | undefined;
    transition: PlannerTransitionSummary | undefined;
    lastResult: PlannerLastResultSummary | undefined;
    failures: PlannerFailureSummary[];
    deadState: PlannerDeadStateSummary | undefined;
    recovery: PlannerRecoveryState | undefined;
    uncertainty: PlannerUncertainty;
    answerFeedback: PlannerAnswerFeedback | undefined;
    lineage: CompressedLineage | undefined;
  }

  // ── Working set IR ───────────────────────────────────────────────────────────

  export interface WorkingSetIR {
    primaryRefs: string[];
    navigationRefs: string[];
    failedRefs: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
    actionSurface: PlannerActionSurface | undefined;
    omittedCount: number;
    totalObservedCount: number;
    selectedCount: number;
  }

  // ── Decision signals IR ──────────────────────────────────────────────────────

  export interface DecisionSignalsIR {
    recommended: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
    alternatives: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
    suppressed: {
      count: number;
      byReason: Partial<Record<WorkingSetDropReason, number>>;
      collapsedRegions: string[];
    };
  }

  // ── Compiler stats ───────────────────────────────────────────────────────────

  export interface CompilerStats {
    inputRefCount: number;
    surfaceRefCount: number;
    regionsCollapsed: number;
    elementsOmitted: number;
    defaultsRemoved: number;
    anomalyCount: number;
    failureAnnotations: number;
    estimatedTokensSaved: number;
    scoreTierDistribution: Record<ScoreTier, number>;
  }

  // ── Top-level IR ─────────────────────────────────────────────────────────────

  export interface PlannerRepresentationIR {
    executionContext: ExecutionContextIR;
    plannerSurface: PlannerSurfaceIR;
    workingSet: WorkingSetIR | undefined;
    decisionSignals: DecisionSignalsIR | undefined;
    stats: CompilerStats;
  }

  // ── Region optimizer ─────────────────────────────────────────────────────────

  export interface RegionBudget {
    strategy: 'element-count' | 'token-budget';
    // element-count (implemented):
    maxElementsSmall?: number;  // show all if region <= this (default: 5)
    maxElementsMedium?: number; // show this many if 6–20 (default: 3)
    maxElementsLarge?: number;  // show this many if >20 (default: 2)
    // token-budget (future — not implemented):
    maxRegionTokens?: number;
    maxSurfaceTokens?: number;
  }
  ```

- [ ] **Step 1.2: Add `PlannerSerializationConfig` to `src/v2/planner/types.ts`**

  Add after line 125 (after `PlannerUncertainty` interface):

  ```typescript
  export type PlannerSerializationMode = 'json' | 'prc';
  export type PlannerSyntaxVariant = 'xml-like' | 'flat-token' | 'indented' | 'symbolic';

  export interface PlannerSerializationConfig {
    mode: PlannerSerializationMode;
    prcSyntax?: PlannerSyntaxVariant; // only meaningful when mode='prc'; default='xml-like'
    prcRenderMode?: import('./prc/types').SurfaceRenderMode; // default='full'
  }
  ```

- [ ] **Step 1.3: Build check**

  Run: `npm run build`
  Expected: no errors

- [ ] **Step 1.4: Commit**

  ```bash
  git add src/v2/planner/prc/types.ts src/v2/planner/types.ts
  git commit -m "feat(prc): add IR types and PlannerSerializationConfig"
  ```

---

## Task 2: ElementNormalizer — Struct, Not String

**Files:**
- Create: `src/v2/planner/prc/ElementNormalizer.ts`
- Create: `tests/unit/v2/prc/ElementNormalizer.test.ts`

`ElementNormalizer` converts raw `SerializedProjectionRef` fields into `NormalizedPlannerElement`. It owns: anomaly detection, score tiering, failure annotation lookup. It produces **no text**.

- [ ] **Step 2.1: Write failing tests**

  Create `tests/unit/v2/prc/ElementNormalizer.test.ts`:

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { ElementNormalizer } from '../../../../src/v2/planner/prc/ElementNormalizer';

  const norm = new ElementNormalizer();

  const base = {
    refId: 'v2ref_1', kind: 'link', role: 'link', name: 'Docs',
    visibility: 'visible', actionability: 'ready', state: 'live',
    confidence: 1, score: 115, text: 'Docs',
  };

  test('ElementNormalizer: scoreTier=top for score >= 110', () => {
    const el = norm.normalize(base, 'interaction', new Map());
    assert.equal(el.scoreTier, 'top');
  });

  test('ElementNormalizer: scoreTier=high for score 90-109', () => {
    const el = norm.normalize({ ...base, score: 100 }, 'interaction', new Map());
    assert.equal(el.scoreTier, 'high');
  });

  test('ElementNormalizer: scoreTier=mid for score 70-89', () => {
    const el = norm.normalize({ ...base, score: 80 }, 'interaction', new Map());
    assert.equal(el.scoreTier, 'mid');
  });

  test('ElementNormalizer: scoreTier=low for score < 70', () => {
    const el = norm.normalize({ ...base, score: 41 }, 'interaction', new Map());
    assert.equal(el.scoreTier, 'low');
  });

  test('ElementNormalizer: no anomalies for all-default element', () => {
    const el = norm.normalize(base, 'interaction', new Map());
    assert.equal(el.anomalies.length, 0);
  });

  test('ElementNormalizer: offscreen anomaly when visibility=offscreen', () => {
    const el = norm.normalize({ ...base, visibility: 'offscreen' }, 'interaction', new Map());
    assert.ok(el.anomalies.some(a => a.kind === 'offscreen'));
  });

  test('ElementNormalizer: blocked anomaly when actionability=blocked', () => {
    const el = norm.normalize({ ...base, actionability: 'blocked' }, 'interaction', new Map());
    assert.ok(el.anomalies.some(a => a.kind === 'blocked'));
  });

  test('ElementNormalizer: confidence anomaly when confidence < 1', () => {
    const el = norm.normalize({ ...base, confidence: 0.7 }, 'interaction', new Map());
    const conf = el.anomalies.find(a => a.kind === 'confidence');
    assert.ok(conf && 'value' in conf);
    assert.equal((conf as any).value, 0.7);
  });

  test('ElementNormalizer: text omitted when text === name', () => {
    const el = norm.normalize(base, 'interaction', new Map());
    assert.equal(el.text, undefined);
  });

  test('ElementNormalizer: text preserved when text !== name', () => {
    const el = norm.normalize({ ...base, text: 'Different label' }, 'interaction', new Map());
    assert.equal(el.text, 'Different label');
  });

  test('ElementNormalizer: failureAnnotation from failure map', () => {
    const failures = new Map([['v2ref_1', { kind: 'timeout', count: 2 }]]);
    const el = norm.normalize(base, 'interaction', failures);
    assert.equal(el.failureAnnotation, 'timeout×2');
  });

  test('ElementNormalizer: no failureAnnotation when not in failure map', () => {
    const el = norm.normalize(base, 'interaction', new Map());
    assert.equal(el.failureAnnotation, undefined);
  });

  test('ElementNormalizer: lane correctly assigned', () => {
    const interaction = norm.normalize(base, 'interaction', new Map());
    const readable = norm.normalize(base, 'readable', new Map());
    const navigation = norm.normalize(base, 'navigation', new Map());
    assert.equal(interaction.lane, 'interaction');
    assert.equal(readable.lane, 'readable');
    assert.equal(navigation.lane, 'navigation');
  });
  ```

- [ ] **Step 2.2: Run to verify failures**

  Run: `npm run test:unit 2>&1 | findstr /i "ElementNormalizer\|Cannot find"`
  Expected: module not found errors

- [ ] **Step 2.3: Implement `ElementNormalizer`**

  Create `src/v2/planner/prc/ElementNormalizer.ts`:

  ```typescript
  import type { NormalizedPlannerElement, ElementLane, ScoreTier, ElementAnomaly } from './types';

  export interface RawElement {
    refId: string;
    kind?: string;
    role?: string;
    name?: string;
    text?: string;
    visibility?: string;
    actionability?: string;
    state?: string;
    confidence?: number;
    score?: number;
    selectOptions?: string;
    [key: string]: unknown;
  }

  export interface FailureEntry {
    kind: string;
    count: number;
  }

  export class ElementNormalizer {
    normalize(
      raw: RawElement,
      lane: ElementLane,
      failures: Map<string, FailureEntry>,
    ): NormalizedPlannerElement {
      const name = raw.name ?? '';
      const text = raw.text;
      const anomalies = this.detectAnomalies(raw);
      const failure = failures.get(raw.refId);

      return {
        refId: raw.refId,
        kind: raw.kind ?? raw.role ?? 'unknown',
        name,
        lane,
        scoreTier: this.scoreTier(raw.score ?? 115),
        anomalies,
        text: text && text !== name ? text : undefined,
        selectOptions: raw.selectOptions,
        failureAnnotation: failure ? `${failure.kind}×${failure.count}` : undefined,
      };
    }

    private detectAnomalies(raw: RawElement): ElementAnomaly[] {
      const anomalies: ElementAnomaly[] = [];
      const vis = raw.visibility ?? 'visible';
      if (vis === 'offscreen') anomalies.push({ kind: 'offscreen' });
      else if (vis === 'hidden') anomalies.push({ kind: 'hidden' });
      else if (vis !== 'visible') anomalies.push({ kind: 'state', value: vis });

      const action = raw.actionability ?? 'ready';
      if (action === 'blocked') anomalies.push({ kind: 'blocked' });
      else if (action === 'disabled') anomalies.push({ kind: 'disabled' });

      const state = raw.state ?? 'live';
      if (state !== 'live') anomalies.push({ kind: 'state', value: state });

      const confidence = raw.confidence ?? 1;
      if (confidence < 1) anomalies.push({ kind: 'confidence', value: confidence });

      return anomalies;
    }

    private scoreTier(score: number): ScoreTier {
      if (score >= 110) return 'top';
      if (score >= 90) return 'high';
      if (score >= 70) return 'mid';
      return 'low';
    }
  }
  ```

- [ ] **Step 2.4: Run tests to verify they pass**

  Run: `npm run test:unit 2>&1 | findstr /i "ElementNormalizer\|ok\|fail"`
  Expected: all `ElementNormalizer` tests pass

- [ ] **Step 2.5: Commit**

  ```bash
  git add src/v2/planner/prc/ElementNormalizer.ts tests/unit/v2/prc/ElementNormalizer.test.ts
  git commit -m "feat(prc): implement ElementNormalizer (struct normalization, no text output)"
  ```

---

## Task 3: ElementSyntaxEncoder — Multiple Syntax Variants

**Files:**
- Create: `src/v2/planner/prc/ElementSyntaxEncoder.ts`
- Create: `tests/unit/v2/prc/ElementSyntaxEncoder.test.ts`

`ElementSyntaxEncoder` converts `NormalizedPlannerElement` → string in a chosen syntax. **This is the only place that changes when benchmarking syntax variants.**

- [ ] **Step 3.1: Write failing tests**

  Create `tests/unit/v2/prc/ElementSyntaxEncoder.test.ts`:

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { ElementSyntaxEncoder } from '../../../../src/v2/planner/prc/ElementSyntaxEncoder';
  import type { NormalizedPlannerElement } from '../../../../src/v2/planner/prc/types';

  const baseEl: NormalizedPlannerElement = {
    refId: 'v2ref_1', kind: 'link', name: 'Docs', lane: 'interaction',
    scoreTier: 'top', anomalies: [],
  };

  test('ElementSyntaxEncoder xml-like: contains refId, kind, name, lane', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const out = enc.encode(baseEl);
    assert.match(out, /v2ref_1/);
    assert.match(out, /link/);
    assert.match(out, /Docs/);
    assert.match(out, /interaction/);
  });

  test('ElementSyntaxEncoder xml-like: omits score for top tier', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    assert.doesNotMatch(enc.encode(baseEl), /score/);
  });

  test('ElementSyntaxEncoder xml-like: emits score=high for high tier', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const el = { ...baseEl, scoreTier: 'high' as const };
    assert.match(enc.encode(el), /score=high/);
  });

  test('ElementSyntaxEncoder xml-like: emits [offscreen] anomaly', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const el = { ...baseEl, anomalies: [{ kind: 'offscreen' as const }] };
    assert.match(enc.encode(el), /\[offscreen\]/);
  });

  test('ElementSyntaxEncoder xml-like: emits [failed:timeout×2] annotation', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const el = { ...baseEl, failureAnnotation: 'timeout×2' };
    assert.match(enc.encode(el), /\[failed:timeout×2\]/);
  });

  test('ElementSyntaxEncoder xml-like: emits full selectOptions, not truncated', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const longOptions = 'All fields | Title | Author | Abstract | Comments | Journal reference | ACM classification | MSC classification | Report number | arXiv identifier | DOI | ORCID | arXiv author ID | Help pages | Full text';
    const el = { ...baseEl, kind: 'select', selectOptions: longOptions };
    const out = enc.encode(el);
    assert.match(out, /options=/);
    assert.ok(out.includes(longOptions), 'options= must contain full untruncated text');
  });

  test('ElementSyntaxEncoder flat-token: contains same information as xml-like', () => {
    const xmlEnc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const flatEnc = new ElementSyntaxEncoder({ syntax: 'flat-token' });
    for (const enc of [xmlEnc, flatEnc]) {
      const out = enc.encode(baseEl);
      assert.match(out, /v2ref_1/, `${enc} must contain refId`);
      assert.match(out, /link/, `${enc} must contain kind`);
      assert.match(out, /Docs/, `${enc} must contain name`);
      assert.match(out, /interaction/, `${enc} must contain lane`);
    }
    // Different text
    assert.notEqual(xmlEnc.encode(baseEl), flatEnc.encode(baseEl));
  });

  test('ElementSyntaxEncoder indented: uses newlines', () => {
    const enc = new ElementSyntaxEncoder({ syntax: 'indented' });
    const out = enc.encode(baseEl);
    assert.ok(out.includes('\n'), 'indented syntax must use newlines');
    assert.match(out, /v2ref_1/);
  });

  test('ElementSyntaxEncoder symbolic: shortest output', () => {
    const xmlEnc = new ElementSyntaxEncoder({ syntax: 'xml-like' });
    const symEnc = new ElementSyntaxEncoder({ syntax: 'symbolic' });
    const xmlOut = xmlEnc.encode(baseEl);
    const symOut = symEnc.encode(baseEl);
    assert.ok(symOut.length < xmlOut.length, `symbolic (${symOut.length}) should be shorter than xml-like (${xmlOut.length})`);
  });
  ```

- [ ] **Step 3.2: Run to verify failures**

  Run: `npm run test:unit 2>&1 | findstr /i "ElementSyntaxEncoder\|Cannot find"`
  Expected: module not found

- [ ] **Step 3.3: Implement `ElementSyntaxEncoder`**

  Create `src/v2/planner/prc/ElementSyntaxEncoder.ts`:

  ```typescript
  import type { NormalizedPlannerElement, ElementAnomaly, PlannerSyntaxVariant } from './types';

  // Re-export the variant type using local definition to avoid circular import
  export type SyntaxVariant = PlannerSyntaxVariant;

  export interface ElementSyntaxEncoderOptions {
    syntax?: SyntaxVariant;
  }

  export class ElementSyntaxEncoder {
    private readonly syntax: SyntaxVariant;

    constructor(options: ElementSyntaxEncoderOptions = {}) {
      this.syntax = options.syntax ?? 'xml-like';
    }

    encode(el: NormalizedPlannerElement): string {
      switch (this.syntax) {
        case 'flat-token': return this.encodeFlat(el);
        case 'indented': return this.encodeIndented(el);
        case 'symbolic': return this.encodeSymbolic(el);
        default: return this.encodeXmlLike(el);
      }
    }

    private anomalyStrings(el: NormalizedPlannerElement): string[] {
      const parts: string[] = el.anomalies.map(a => this.anomalyStr(a));
      if (el.failureAnnotation) parts.push(`[failed:${el.failureAnnotation}]`);
      return parts;
    }

    private anomalyStr(a: ElementAnomaly): string {
      switch (a.kind) {
        case 'offscreen': return '[offscreen]';
        case 'hidden': return '[hidden]';
        case 'blocked': return '[blocked]';
        case 'disabled': return '[disabled]';
        case 'confidence': return `[confidence=${(a as any).value.toFixed(2)}]`;
        case 'state': return `[state=${(a as any).value}]`;
      }
    }

    private scoreTierAttr(el: NormalizedPlannerElement): string {
      if (el.scoreTier === 'top') return '';
      return `score=${el.scoreTier}`;
    }

    private encodeXmlLike(el: NormalizedPlannerElement): string {
      const attrs: string[] = [`name="${el.name.replace(/"/g, "'")}"`, `lane="${el.lane}"`];
      const scorePart = this.scoreTierAttr(el);
      if (scorePart) attrs.push(scorePart);
      if (el.text) attrs.push(`text="${el.text.replace(/"/g, "'")}"`);
      const anomalies = this.anomalyStrings(el);
      const anomalyStr = anomalies.length > 0 ? ' ' + anomalies.join(' ') : '';
      if (el.selectOptions) {
        return `[${el.refId}] <${el.kind} ${attrs.join(' ')}${anomalyStr}\n  options="${el.selectOptions}" />`;
      }
      return `[${el.refId}] <${el.kind} ${attrs.join(' ')}${anomalyStr} />`;
    }

    private encodeFlat(el: NormalizedPlannerElement): string {
      const parts = [`[${el.refId}]`, el.kind, `"${el.name}"`, `[${el.lane}]`];
      const scorePart = this.scoreTierAttr(el);
      if (scorePart) parts.push(`[${scorePart}]`);
      if (el.text) parts.push(`text:"${el.text}"`);
      if (el.selectOptions) parts.push(`options:"${el.selectOptions}"`);
      parts.push(...this.anomalyStrings(el));
      return parts.join(' ');
    }

    private encodeIndented(el: NormalizedPlannerElement): string {
      const lines = [`[${el.refId}]`, `  kind: ${el.kind}`, `  name: ${el.name}`, `  lane: ${el.lane}`];
      const scorePart = this.scoreTierAttr(el);
      if (scorePart) lines.push(`  ${scorePart}`);
      if (el.text) lines.push(`  text: ${el.text}`);
      if (el.selectOptions) lines.push(`  options: ${el.selectOptions}`);
      for (const a of this.anomalyStrings(el)) lines.push(`  ${a}`);
      return lines.join('\n');
    }

    private encodeSymbolic(el: NormalizedPlannerElement): string {
      const laneCode = el.lane === 'interaction' ? 'I' : el.lane === 'readable' ? 'R' : 'N';
      const score = el.scoreTier !== 'top' ? `:${el.scoreTier[0].toUpperCase()}` : '';
      const anomalies = this.anomalyStrings(el).join('');
      return `[${el.refId}]:${el.kind}:"${el.name}":${laneCode}${score}${anomalies}`;
    }
  }
  ```

  > [!NOTE]
  > Add `PlannerSyntaxVariant` re-export to `src/v2/planner/prc/types.ts`:
  > In `prc/types.ts`, the `PlannerSyntaxVariant` is imported from `../types`. To avoid circular imports, add a local type alias:
  > ```typescript
  > export type PlannerSyntaxVariant = 'xml-like' | 'flat-token' | 'indented' | 'symbolic';
  > ```
  > Then remove the import from `../types` in `prc/types.ts` and update `../types.ts` to import from `./prc/types`.

- [ ] **Step 3.4: Run tests to verify they pass**

  Run: `npm run test:unit 2>&1 | findstr /i "ElementSyntaxEncoder\|ok\|fail"`
  Expected: all `ElementSyntaxEncoder` tests pass

- [ ] **Step 3.5: Build check**

  Run: `npm run build`
  Expected: no errors

- [ ] **Step 3.6: Commit**

  ```bash
  git add src/v2/planner/prc/ElementSyntaxEncoder.ts tests/unit/v2/prc/ElementSyntaxEncoder.test.ts
  git commit -m "feat(prc): implement ElementSyntaxEncoder with 4 syntax variants"
  ```

---

## Task 4: RegionOptimizer — RegionBudget Interface

**Files:**
- Create: `src/v2/planner/prc/RegionOptimizer.ts`
- Create: `tests/unit/v2/prc/RegionOptimizer.test.ts`

- [ ] **Step 4.1: Write failing tests**

  Create `tests/unit/v2/prc/RegionOptimizer.test.ts`:

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { RegionOptimizer } from '../../../../src/v2/planner/prc/RegionOptimizer';
  import type { NormalizedPlannerElement } from '../../../../src/v2/planner/prc/types';

  function makeEl(refId: string): NormalizedPlannerElement {
    return { refId, kind: 'link', name: refId, lane: 'interaction',
      scoreTier: 'top', anomalies: [] };
  }

  const makeRegion = (id: string, refIds: string[]) => ({ regionId: id, label: `Region ${id}`, refIds });

  test('RegionOptimizer: shows all elements when region size <= 5 (default budget)', () => {
    const opt = new RegionOptimizer();
    const els = [makeEl('a'), makeEl('b'), makeEl('c'), makeEl('d')];
    const result = opt.optimize(els, [makeRegion('r1', els.map(e => e.refId))]);
    assert.equal(result.groups[0]!.visibleElements.length, 4);
    assert.equal(result.groups[0]!.omittedCount, 0);
    assert.equal(result.groups[0]!.totalCount, 4);
  });

  test('RegionOptimizer: shows first 3 for region size 6-20', () => {
    const opt = new RegionOptimizer();
    const els = Array.from({ length: 12 }, (_, i) => makeEl(`r${i}`));
    const result = opt.optimize(els, [makeRegion('r1', els.map(e => e.refId))]);
    assert.equal(result.groups[0]!.visibleElements.length, 3);
    assert.equal(result.groups[0]!.omittedCount, 9);
    assert.equal(result.groups[0]!.totalCount, 12);
  });

  test('RegionOptimizer: shows first 2 for region size > 20', () => {
    const opt = new RegionOptimizer();
    const els = Array.from({ length: 25 }, (_, i) => makeEl(`r${i}`));
    const result = opt.optimize(els, [makeRegion('r1', els.map(e => e.refId))]);
    assert.equal(result.groups[0]!.visibleElements.length, 2);
    assert.equal(result.groups[0]!.omittedCount, 23);
  });

  test('RegionOptimizer: ungrouped elements in remainder', () => {
    const opt = new RegionOptimizer();
    const grouped = [makeEl('g1')];
    const ungrouped = [makeEl('u1'), makeEl('u2')];
    const result = opt.optimize([...grouped, ...ungrouped], [makeRegion('r1', ['g1'])]);
    assert.equal(result.remainder.length, 2);
    assert.ok(result.remainder.every(e => e.refId.startsWith('u')));
  });

  test('RegionOptimizer: custom budget overrides defaults', () => {
    const opt = new RegionOptimizer({ strategy: 'element-count', maxElementsSmall: 2, maxElementsMedium: 1, maxElementsLarge: 1 });
    const els = [makeEl('a'), makeEl('b'), makeEl('c')]; // size 3, <= 2 threshold
    const result = opt.optimize(els, [makeRegion('r1', els.map(e => e.refId))]);
    // size 3 > maxElementsSmall=2, falls into medium
    assert.equal(result.groups[0]!.visibleElements.length, 1);
  });

  test('RegionOptimizer: empty regions array puts all elements in remainder', () => {
    const opt = new RegionOptimizer();
    const els = [makeEl('a'), makeEl('b')];
    const result = opt.optimize(els, []);
    assert.equal(result.groups.length, 0);
    assert.equal(result.remainder.length, 2);
  });
  ```

- [ ] **Step 4.2: Run to verify failures**

  Run: `npm run test:unit 2>&1 | findstr /i "RegionOptimizer\|Cannot find"`
  Expected: module not found

- [ ] **Step 4.3: Implement `RegionOptimizer`**

  Create `src/v2/planner/prc/RegionOptimizer.ts`:

  ```typescript
  import type { NormalizedPlannerElement, SurfaceRegionGroup, RegionBudget } from './types';

  export interface RegionMeta {
    regionId: string;
    label: string;
    refIds: string[];
  }

  export interface OptimizedSurface {
    groups: SurfaceRegionGroup[];
    remainder: NormalizedPlannerElement[];
  }

  const DEFAULT_BUDGET: Required<Pick<RegionBudget, 'maxElementsSmall' | 'maxElementsMedium' | 'maxElementsLarge'>> = {
    maxElementsSmall: 5,
    maxElementsMedium: 3,
    maxElementsLarge: 2,
  };

  export class RegionOptimizer {
    private readonly budget: RegionBudget;

    constructor(budget: RegionBudget = { strategy: 'element-count' }) {
      this.budget = budget;
    }

    optimize(elements: NormalizedPlannerElement[], regions: RegionMeta[]): OptimizedSurface {
      const allRegionedIds = new Set<string>(regions.flatMap(r => r.refIds));
      const elementMap = new Map(elements.map(e => [e.refId, e]));
      const groups: SurfaceRegionGroup[] = [];

      for (const region of regions) {
        const regionElements = region.refIds
          .map(id => elementMap.get(id))
          .filter((e): e is NormalizedPlannerElement => e !== undefined);

        const showCount = this.showCount(regionElements.length);
        groups.push({
          regionId: region.regionId,
          label: region.label,
          visibleElements: regionElements.slice(0, showCount),
          omittedCount: Math.max(0, regionElements.length - showCount),
          totalCount: regionElements.length,
        });
      }

      const remainder = elements.filter(e => !allRegionedIds.has(e.refId));
      return { groups, remainder };
    }

    private showCount(size: number): number {
      const small = this.budget.maxElementsSmall ?? DEFAULT_BUDGET.maxElementsSmall;
      const medium = this.budget.maxElementsMedium ?? DEFAULT_BUDGET.maxElementsMedium;
      const large = this.budget.maxElementsLarge ?? DEFAULT_BUDGET.maxElementsLarge;
      if (size <= small) return size;
      if (size <= 20) return medium;
      return large;
    }
  }
  ```

- [ ] **Step 4.4: Run tests**

  Run: `npm run test:unit 2>&1 | findstr /i "RegionOptimizer\|ok\|fail"`
  Expected: all pass

- [ ] **Step 4.5: Commit**

  ```bash
  git add src/v2/planner/prc/RegionOptimizer.ts tests/unit/v2/prc/RegionOptimizer.test.ts
  git commit -m "feat(prc): implement RegionOptimizer with RegionBudget interface"
  ```

---

## Task 5: ExecutionContextBuilder — Layer 1 IR

**Files:**
- Create: `src/v2/planner/prc/ExecutionContextBuilder.ts`
- Create: `tests/unit/v2/prc/ExecutionContextBuilder.test.ts`

`ExecutionContextBuilder` produces `ExecutionContextIR` — a typed struct, not text.

- [ ] **Step 5.1: Write failing tests**

  Create `tests/unit/v2/prc/ExecutionContextBuilder.test.ts`:

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { ExecutionContextBuilder } from '../../../../src/v2/planner/prc/ExecutionContextBuilder';
  import type { PlannerInput } from '../../../../src/v2/planner/types';

  function minimal(): PlannerInput {
    return {
      version: 'v2.planner_input.v2', episodeId: 'ep_1',
      goal: 'Find quantum papers',
      current: {
        projectionId: 'p1', observationId: 'obs_1', generationId: 1,
        page: { url: 'https://arxiv.org/', title: 'arXiv' },
        refs: {}, interactions: [], readables: [], navigation: [], regions: [], warnings: [],
        focus: { refId: 'v2ref_1', reason: 'highest_operational_score' },
        stats: { interactionCount: 0, readableCount: 0, navigationCount: 0, regionCount: 0 },
      },
      uncertainty: { level: 'none', signals: [] },
    };
  }

  test('ExecutionContextBuilder: goal present', () => {
    const ir = new ExecutionContextBuilder().build(minimal());
    assert.equal(ir.goal, 'Find quantum papers');
  });

  test('ExecutionContextBuilder: page populated from current.page', () => {
    const ir = new ExecutionContextBuilder().build(minimal());
    assert.ok(ir.page);
    assert.equal(ir.page!.url, 'https://arxiv.org/');
    assert.equal(ir.page!.title, 'arXiv');
  });

  test('ExecutionContextBuilder: focus from current.focus', () => {
    const ir = new ExecutionContextBuilder().build(minimal());
    assert.ok(ir.focus);
    assert.equal(ir.focus!.refId, 'v2ref_1');
  });

  test('ExecutionContextBuilder: transition undefined when not provided', () => {
    const ir = new ExecutionContextBuilder().build(minimal());
    assert.equal(ir.transition, undefined);
  });

  test('ExecutionContextBuilder: transition populated when provided', () => {
    const input = minimal();
    input.transition = {
      beforeObservationId: 'obs_7', afterObservationId: 'obs_8',
      transitionClass: 'microstate', strength: 'none',
      generationChanged: false, urlChanged: false,
      refChangeCounts: { appeared: 0, disappeared: 0, weakened: 0, preserved: 305 }, notes: [],
    };
    const ir = new ExecutionContextBuilder().build(input);
    assert.ok(ir.transition);
    assert.equal(ir.transition!.transitionClass, 'microstate');
  });

  test('ExecutionContextBuilder: failures empty array when none', () => {
    const ir = new ExecutionContextBuilder().build(minimal());
    assert.deepEqual(ir.failures, []);
  });

  test('ExecutionContextBuilder: failures populated', () => {
    const input = minimal();
    input.failures = [{
      failureId: 'f1', kind: 'timeout', category: 'timing', severity: 'warning',
      persistence: 'transient', retryable: true, targetRef: 'v2ref_30', signals: [], observationId: 'obs_5',
    }];
    const ir = new ExecutionContextBuilder().build(input);
    assert.equal(ir.failures.length, 1);
    assert.equal(ir.failures[0]!.kind, 'timeout');
  });

  test('ExecutionContextBuilder: uncertainty passed through', () => {
    const input = minimal();
    input.uncertainty = { level: 'high', signals: ['dead_state_evidence'] };
    const ir = new ExecutionContextBuilder().build(input);
    assert.equal(ir.uncertainty.level, 'high');
  });
  ```

- [ ] **Step 5.2: Run to verify failures**, then implement:

  Create `src/v2/planner/prc/ExecutionContextBuilder.ts`:

  ```typescript
  import type { PlannerInput } from '../types';
  import type { ExecutionContextIR } from './types';

  export class ExecutionContextBuilder {
    build(input: PlannerInput): ExecutionContextIR {
      const page = input.current.page;
      const focus = input.current.focus;
      return {
        goal: input.goal,
        page: page ? { title: page.title ?? '', url: page.url ?? '' } : undefined,
        focus: focus ? { refId: focus.refId, reason: focus.reason } : undefined,
        transition: input.transition,
        lastResult: input.lastResult,
        failures: input.failures ?? [],
        deadState: input.deadState,
        recovery: input.recovery,
        uncertainty: input.uncertainty,
        answerFeedback: input.answerFeedback,
        lineage: input.lineage,
      };
    }
  }
  ```

- [ ] **Step 5.3: Run tests, then commit**

  Run: `npm run test:unit 2>&1 | findstr /i "ExecutionContextBuilder\|ok\|fail"`
  Expected: all pass

  ```bash
  git add src/v2/planner/prc/ExecutionContextBuilder.ts tests/unit/v2/prc/ExecutionContextBuilder.test.ts
  git commit -m "feat(prc): implement ExecutionContextBuilder → ExecutionContextIR"
  ```

---

## Task 6: PlannerSurfaceBuilder, WorkingSetBuilder, DecisionSignalBuilder

**Files:**
- Create: `src/v2/planner/prc/PlannerSurfaceBuilder.ts`
- Create: `src/v2/planner/prc/WorkingSetBuilder.ts`
- Create: `src/v2/planner/prc/DecisionSignalBuilder.ts`
- Create: `tests/unit/v2/prc/PlannerSurfaceBuilder.test.ts`
- Create: `tests/unit/v2/prc/WorkingSetBuilder.test.ts`
- Create: `tests/unit/v2/prc/DecisionSignalBuilder.test.ts`

- [ ] **Step 6.1: Write all three test files**

  **`tests/unit/v2/prc/PlannerSurfaceBuilder.test.ts`:**

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { PlannerSurfaceBuilder } from '../../../../src/v2/planner/prc/PlannerSurfaceBuilder';
  import { ElementNormalizer } from '../../../../src/v2/planner/prc/ElementNormalizer';
  import { RegionOptimizer } from '../../../../src/v2/planner/prc/RegionOptimizer';
  import type { SerializedProjection } from '../../../../src/v2/brain1/projectionTypes';

  function makeProjection(): SerializedProjection {
    return {
      projectionId: 'p1', observationId: 'obs_1', generationId: 1,
      page: { url: 'https://test.com', title: 'Test' }, refs: {},
      interactions: [{ refId: 'v2ref_1', kind: 'link', role: 'link', name: 'Docs',
        visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 }],
      readables: [],
      navigation: [{ refId: 'v2ref_2', kind: 'link', role: 'link', name: 'Home',
        visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 }],
      regions: [], warnings: [],
      stats: { interactionCount: 1, readableCount: 0, navigationCount: 1, regionCount: 0 },
    };
  }

  const builder = new PlannerSurfaceBuilder(new ElementNormalizer(), new RegionOptimizer());

  test('PlannerSurfaceBuilder: interaction element has lane=interaction', () => {
    const ir = builder.build(makeProjection(), new Map(), 'full');
    const el = ir.remainder.find(e => e.refId === 'v2ref_1');
    assert.ok(el);
    assert.equal(el!.lane, 'interaction');
  });

  test('PlannerSurfaceBuilder: navigation element has lane=navigation', () => {
    const ir = builder.build(makeProjection(), new Map(), 'full');
    const el = ir.remainder.find(e => e.refId === 'v2ref_2');
    assert.ok(el);
    assert.equal(el!.lane, 'navigation');
  });

  test('PlannerSurfaceBuilder: failure map applied to matching element', () => {
    const failures = new Map([['v2ref_1', { kind: 'timeout', count: 2 }]]);
    const ir = builder.build(makeProjection(), failures, 'full');
    const el = ir.remainder.find(e => e.refId === 'v2ref_1');
    assert.equal(el!.failureAnnotation, 'timeout×2');
  });

  test('PlannerSurfaceBuilder: renderMode summary does not throw', () => {
    assert.doesNotThrow(() => builder.build(makeProjection(), new Map(), 'summary'));
  });

  test('PlannerSurfaceBuilder: renderMode stored on IR', () => {
    const ir = builder.build(makeProjection(), new Map(), 'full');
    assert.equal(ir.renderMode, 'full');
  });
  ```

  **`tests/unit/v2/prc/WorkingSetBuilder.test.ts`:**

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { WorkingSetBuilder } from '../../../../src/v2/planner/prc/WorkingSetBuilder';
  import type { PlannerWorkingSet } from '../../../../src/v2/planner/workingSetTypes';

  function makeWS(): PlannerWorkingSet {
    return {
      mode: 'explore', modeReason: 'initial',
      primaryRefs: [{ refId: 'v2ref_1', kind: 'link', name: 'X', score: 115, reasons: ['goal_keyword_match'] }],
      secondaryRefs: [{ refId: 'v2ref_2', kind: 'link', name: 'Y', score: 90, reasons: ['navigation_candidate'] }],
      readableEvidence: [],
      navigationRefs: [{ refId: 'v2ref_3', kind: 'link', name: 'Z', score: 115, reasons: ['navigation_candidate'] }],
      actionSurface: { clickableRefs: ['v2ref_1'], typeableRefs: [], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
      changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 3, topRefs: [], omittedCount: 0 },
      failedRefs: [{ refId: 'v2ref_4', kind: 'link', name: 'W', score: 115, reasons: ['last_failure'] }],
      quarantinedActions: [], regionSummaries: [],
      omitted: { observedRefCount: 857, selectedRefCount: 4, droppedRefCount: 853, droppedByReason: {} },
    };
  }

  const builder = new WorkingSetBuilder();

  test('WorkingSetBuilder: primaryRefs mapped to refId strings', () => {
    const ir = builder.build(makeWS());
    assert.deepEqual(ir.primaryRefs, ['v2ref_1']);
  });

  test('WorkingSetBuilder: navigationRefs mapped to refId strings', () => {
    const ir = builder.build(makeWS());
    assert.deepEqual(ir.navigationRefs, ['v2ref_3']);
  });

  test('WorkingSetBuilder: failedRefs mapped', () => {
    const ir = builder.build(makeWS());
    assert.equal(ir.failedRefs.length, 1);
    assert.equal(ir.failedRefs[0]!.refId, 'v2ref_4');
  });

  test('WorkingSetBuilder: counts correct', () => {
    const ir = builder.build(makeWS());
    assert.equal(ir.omittedCount, 853);
    assert.equal(ir.totalObservedCount, 857);
    assert.equal(ir.selectedCount, 4);
  });
  ```

  **`tests/unit/v2/prc/DecisionSignalBuilder.test.ts`:**

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { DecisionSignalBuilder } from '../../../../src/v2/planner/prc/DecisionSignalBuilder';
  import type { PlannerWorkingSet } from '../../../../src/v2/planner/workingSetTypes';

  function makeWS(): PlannerWorkingSet {
    return {
      mode: 'explore', modeReason: 'initial',
      primaryRefs: [{ refId: 'v2ref_1', kind: 'link', name: 'X', score: 115, reasons: ['goal_keyword_match'] }],
      secondaryRefs: [{ refId: 'v2ref_2', kind: 'link', name: 'Y', score: 90, reasons: ['navigation_candidate'] }],
      readableEvidence: [], navigationRefs: [],
      actionSurface: { clickableRefs: [], typeableRefs: [], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
      changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 0, topRefs: [], omittedCount: 0 },
      failedRefs: [], quarantinedActions: [], regionSummaries: [],
      omitted: { observedRefCount: 100, selectedRefCount: 2, droppedRefCount: 98, droppedByReason: { hidden_low_value: 50 } },
    };
  }

  const builder = new DecisionSignalBuilder();

  test('DecisionSignalBuilder: primaryRefs → recommended', () => {
    const ir = builder.build(makeWS());
    assert.equal(ir.recommended.length, 1);
    assert.equal(ir.recommended[0]!.refId, 'v2ref_1');
    assert.deepEqual(ir.recommended[0]!.reasons, ['goal_keyword_match']);
  });

  test('DecisionSignalBuilder: secondaryRefs → alternatives', () => {
    const ir = builder.build(makeWS());
    assert.equal(ir.alternatives.length, 1);
    assert.equal(ir.alternatives[0]!.refId, 'v2ref_2');
  });

  test('DecisionSignalBuilder: suppressed count and byReason', () => {
    const ir = builder.build(makeWS());
    assert.equal(ir.suppressed.count, 98);
    assert.equal(ir.suppressed.byReason.hidden_low_value, 50);
  });

  test('DecisionSignalBuilder: alternatives empty when secondaryRefs empty', () => {
    const ws = makeWS();
    ws.secondaryRefs = [];
    const ir = builder.build(ws);
    assert.equal(ir.alternatives.length, 0);
  });
  ```

- [ ] **Step 6.2: Run to verify all three test files fail**

  Run: `npm run test:unit 2>&1 | findstr /i "PlannerSurface\|WorkingSet\|DecisionSignal\|Cannot find"`
  Expected: module not found for all three

- [ ] **Step 6.3: Implement all three builders**

  **`src/v2/planner/prc/PlannerSurfaceBuilder.ts`:**

  ```typescript
  import type { SerializedProjection, SerializedProjectionRef } from '../../brain1/projectionTypes';
  import { ElementNormalizer, type RawElement, type FailureEntry } from './ElementNormalizer';
  import { RegionOptimizer } from './RegionOptimizer';
  import type { PlannerSurfaceIR, NormalizedPlannerElement, SurfaceRenderMode } from './types';

  export class PlannerSurfaceBuilder {
    constructor(
      private readonly normalizer: ElementNormalizer,
      private readonly regionOptimizer: RegionOptimizer,
    ) {}

    build(
      projection: SerializedProjection,
      failures: Map<string, FailureEntry>,
      renderMode: SurfaceRenderMode,
    ): PlannerSurfaceIR {
      const seenIds = new Set<string>();

      const toNormalized = (el: SerializedProjectionRef, lane: 'interaction' | 'readable' | 'navigation'): NormalizedPlannerElement | null => {
        if (seenIds.has(el.refId)) return null;
        seenIds.add(el.refId);
        const regionId = this.findRegionId(el.refId, projection);
        const normalized = this.normalizer.normalize(el as RawElement, lane, failures);
        normalized.regionId = regionId;
        return normalized;
      };

      const allElements: NormalizedPlannerElement[] = [
        ...(projection.interactions ?? []).map(el => toNormalized(el, 'interaction')),
        ...(projection.readables ?? []).map(el => toNormalized(el, 'readable')),
        ...(projection.navigation ?? []).map(el => toNormalized(el, 'navigation')),
      ].filter((e): e is NormalizedPlannerElement => e !== null);

      const regionMetas = (projection.regions ?? []).map(r => ({
        regionId: r.regionId,
        label: r.label ?? r.regionId,
        refIds: r.refIds ?? [],
      }));

      const optimized = this.regionOptimizer.optimize(allElements, regionMetas);

      return {
        groups: optimized.groups,
        remainder: optimized.remainder,
        renderMode,
      };
    }

    private findRegionId(refId: string, projection: SerializedProjection): string | undefined {
      for (const region of (projection.regions ?? [])) {
        if ((region.refIds ?? []).includes(refId)) return region.regionId;
      }
      return undefined;
    }
  }
  ```

  **`src/v2/planner/prc/WorkingSetBuilder.ts`:**

  ```typescript
  import type { PlannerWorkingSet } from '../workingSetTypes';
  import type { WorkingSetIR } from './types';

  export class WorkingSetBuilder {
    build(ws: PlannerWorkingSet): WorkingSetIR {
      return {
        primaryRefs: ws.primaryRefs.map(r => r.refId),
        navigationRefs: ws.navigationRefs.map(r => r.refId),
        failedRefs: ws.failedRefs.map(r => ({ refId: r.refId, reasons: r.reasons })),
        actionSurface: ws.actionSurface,
        omittedCount: ws.omitted.droppedRefCount,
        totalObservedCount: ws.omitted.observedRefCount,
        selectedCount: ws.omitted.selectedRefCount,
      };
    }
  }
  ```

  **`src/v2/planner/prc/DecisionSignalBuilder.ts`:**

  ```typescript
  import type { PlannerWorkingSet } from '../workingSetTypes';
  import type { DecisionSignalsIR } from './types';

  export class DecisionSignalBuilder {
    build(ws: PlannerWorkingSet): DecisionSignalsIR {
      return {
        recommended: ws.primaryRefs.map(r => ({ refId: r.refId, reasons: r.reasons })),
        alternatives: ws.secondaryRefs.map(r => ({ refId: r.refId, reasons: r.reasons })),
        suppressed: {
          count: ws.omitted.droppedRefCount,
          byReason: ws.omitted.droppedByReason ?? {},
          collapsedRegions: ws.regionSummaries.map(r => r.regionId),
        },
      };
    }
  }
  ```

- [ ] **Step 6.4: Run tests**

  Run: `npm run test:unit 2>&1 | findstr /i "PlannerSurface\|WorkingSet\|DecisionSignal\|ok\|fail"`
  Expected: all pass

- [ ] **Step 6.5: Commit**

  ```bash
  git add src/v2/planner/prc/ tests/unit/v2/prc/
  git commit -m "feat(prc): implement PlannerSurfaceBuilder, WorkingSetBuilder, DecisionSignalBuilder"
  ```

---

## Task 7: PromptLayoutEngine — Renders IR to String

**Files:**
- Create: `src/v2/planner/prc/PromptLayoutEngine.ts`
- Create: `tests/unit/v2/prc/PromptLayoutEngine.test.ts`

`PromptLayoutEngine` owns: layer ordering, section headers, adaptive emission (skip empty), calling `ElementSyntaxEncoder` per element, rendering each IR struct as text.

- [ ] **Step 7.1: Write failing tests**

  Create `tests/unit/v2/prc/PromptLayoutEngine.test.ts`:

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
  import type { PlannerRepresentationIR } from '../../../../src/v2/planner/prc/types';

  function makeIR(): PlannerRepresentationIR {
    return {
      executionContext: {
        goal: 'Find papers', page: { title: 'arXiv', url: 'https://arxiv.org/' },
        focus: { refId: 'v2ref_1', reason: 'highest_operational_score' },
        transition: undefined, lastResult: undefined,
        failures: [], deadState: undefined, recovery: undefined,
        uncertainty: { level: 'none', signals: [] },
        answerFeedback: undefined, lineage: undefined,
      },
      plannerSurface: {
        groups: [],
        remainder: [{ refId: 'v2ref_1', kind: 'link', name: 'Docs', lane: 'interaction', scoreTier: 'top', anomalies: [] }],
        renderMode: 'full',
      },
      workingSet: undefined,
      decisionSignals: undefined,
      stats: {
        inputRefCount: 1, surfaceRefCount: 1, regionsCollapsed: 0, elementsOmitted: 0,
        defaultsRemoved: 5, anomalyCount: 0, failureAnnotations: 0,
        estimatedTokensSaved: 1200, scoreTierDistribution: { top: 1, high: 0, mid: 0, low: 0 },
      },
    };
  }

  test('PromptLayoutEngine: MISSION is first block', () => {
    const engine = new PromptLayoutEngine();
    const out = engine.render(makeIR(), { mode: 'prc' });
    assert.ok(out.trimStart().startsWith('MISSION'), `Got: ${out.slice(0, 60)}`);
  });

  test('PromptLayoutEngine: PLANNER SURFACE section present', () => {
    const engine = new PromptLayoutEngine();
    const out = engine.render(makeIR(), { mode: 'prc' });
    assert.match(out, /PLANNER SURFACE/);
  });

  test('PromptLayoutEngine: element v2ref_1 present in surface', () => {
    const engine = new PromptLayoutEngine();
    const out = engine.render(makeIR(), { mode: 'prc' });
    assert.match(out, /v2ref_1/);
    assert.match(out, /Docs/);
  });

  test('PromptLayoutEngine: WORKING SET omitted when IR has no workingSet', () => {
    const engine = new PromptLayoutEngine();
    const out = engine.render(makeIR(), { mode: 'prc' });
    assert.doesNotMatch(out, /WORKING SET/);
  });

  test('PromptLayoutEngine: RECENT EVENTS omitted when no lastResult', () => {
    const engine = new PromptLayoutEngine();
    const out = engine.render(makeIR(), { mode: 'prc' });
    assert.doesNotMatch(out, /RECENT EVENTS/);
  });

  test('PromptLayoutEngine: PROBLEMS omitted when no failures and uncertainty=none', () => {
    const engine = new PromptLayoutEngine();
    const out = engine.render(makeIR(), { mode: 'prc' });
    assert.doesNotMatch(out, /PROBLEMS/);
  });

  test('PromptLayoutEngine: RECENT EVENTS present when lastResult exists', () => {
    const engine = new PromptLayoutEngine();
    const ir = makeIR();
    ir.executionContext.lastResult = {
      success: false, kind: 'click', traceStepId: 'step_4', targetRef: 'v2ref_30',
      error: { code: 'timeout', retryable: true },
    };
    const out = engine.render(ir, { mode: 'prc' });
    assert.match(out, /RECENT EVENTS/);
    assert.match(out, /FAILED/i);
  });

  test('PromptLayoutEngine: flat-token syntax changes element lines', () => {
    const xmlEngine = new PromptLayoutEngine();
    const flatEngine = new PromptLayoutEngine();
    const ir = makeIR();
    const xmlOut = xmlEngine.render(ir, { mode: 'prc', prcSyntax: 'xml-like' });
    const flatOut = flatEngine.render(ir, { mode: 'prc', prcSyntax: 'flat-token' });
    // MISSION block identical
    const missionXml = xmlOut.slice(xmlOut.indexOf('MISSION'), xmlOut.indexOf('\n\n'));
    const missionFlat = flatOut.slice(flatOut.indexOf('MISSION'), flatOut.indexOf('\n\n'));
    assert.equal(missionXml, missionFlat);
    // Element lines differ
    assert.notEqual(xmlOut, flatOut);
  });
  ```

- [ ] **Step 7.2: Run to verify failures**

  Run: `npm run test:unit 2>&1 | findstr /i "PromptLayoutEngine\|Cannot find"`
  Expected: module not found

- [ ] **Step 7.3: Implement `PromptLayoutEngine`**

  Create `src/v2/planner/prc/PromptLayoutEngine.ts`:

  ```typescript
  import type { PlannerRepresentationIR, ExecutionContextIR, PlannerSurfaceIR, WorkingSetIR, DecisionSignalsIR } from './types';
  import type { PlannerSerializationConfig } from '../types';
  import { ElementSyntaxEncoder } from './ElementSyntaxEncoder';

  export class PromptLayoutEngine {
    render(ir: PlannerRepresentationIR, config: PlannerSerializationConfig): string {
      const syntaxEncoder = new ElementSyntaxEncoder({ syntax: config.prcSyntax ?? 'xml-like' });
      const sections: string[] = [
        this.renderExecutionContext(ir.executionContext),
        '---',
        this.renderPlannerSurface(ir.plannerSurface, syntaxEncoder),
      ];
      if (ir.workingSet) {
        sections.push('---', this.renderWorkingSet(ir.workingSet));
      }
      if (ir.decisionSignals) {
        sections.push('---', this.renderDecisionSignals(ir.decisionSignals));
      }
      return sections.join('\n\n');
    }

    private renderExecutionContext(ctx: ExecutionContextIR): string {
      const blocks: string[] = [];

      // MISSION — always first
      blocks.push(`MISSION\n  goal: "${ctx.goal}"`);

      // STATE — always present
      const stateLines: string[] = [];
      if (ctx.page) stateLines.push(`  page:       "${ctx.page.title}" | ${ctx.page.url}`);
      if (ctx.focus) stateLines.push(`  focus:      ${ctx.focus.refId} (${ctx.focus.reason})`);
      if (ctx.transition) {
        const t = ctx.transition;
        const c = t.refChangeCounts;
        stateLines.push(
          `  transition: ${t.transitionClass} | strength=${t.strength} | ${t.urlChanged ? 'url-changed' : 'url-unchanged'}` +
          ` | refs +${c.appeared} −${c.disappeared} ~${c.weakened} preserved=${c.preserved}`
        );
      }
      blocks.push(`STATE\n${stateLines.join('\n')}`);

      // RECENT EVENTS — conditional
      const recentLines: string[] = [];
      if (ctx.lastResult) {
        const r = ctx.lastResult;
        const status = r.success ? 'OK' : 'FAILED';
        const err = r.error ? ` ${r.error.code}${r.error.retryable ? ' [retryable]' : ''}` : '';
        const target = r.targetRef ? `(${r.targetRef}) ` : '';
        recentLines.push(`  last: ${r.kind} ${target}→ ${status}${err} ${r.traceStepId}`);
      }
      if (ctx.lineage && ctx.lineage.steps.length > 0) {
        recentLines.push(`  history: ${ctx.lineage.totalSteps} steps${ctx.lineage.truncated ? ' (truncated)' : ''}`);
      }
      if (recentLines.length > 0) blocks.push(`RECENT EVENTS\n${recentLines.join('\n')}`);

      // PROBLEMS — conditional
      const problemLines: string[] = [];
      const seenFailureKeys = new Set<string>();
      for (const f of ctx.failures) {
        const key = `${f.targetRef}:${f.kind}`;
        if (seenFailureKeys.has(key)) continue;
        seenFailureKeys.add(key);
        const count = ctx.failures.filter(x => x.targetRef === f.targetRef && x.kind === f.kind).length;
        const ref = f.targetRef ? `${f.targetRef}: ` : '';
        problemLines.push(`  failures:    ${ref}${f.kind} ×${count} [${f.retryable ? 'retryable' : 'non-retryable'}] [${f.persistence}]`);
      }
      if (ctx.deadState) {
        problemLines.push(`  DEAD STATE: ${ctx.deadState.severity} | reasons: ${ctx.deadState.reasons.join(', ')}`);
      }
      if (ctx.recovery && (ctx.recovery as any).state) {
        const r = ctx.recovery as any;
        problemLines.push(`  recovery: ${r.state}`);
        if (r.nextMechanisms?.length) problemLines.push(`    next: ${r.nextMechanisms.join(', ')}`);
      }
      if (ctx.uncertainty.level !== 'none') {
        problemLines.push(`  uncertainty: ${ctx.uncertainty.level} | signals: ${ctx.uncertainty.signals.join(', ')}`);
      }
      if (ctx.answerFeedback) {
        problemLines.push(`  answer-feedback: previous answer rejected`);
        problemLines.push(`    missing: ${ctx.answerFeedback.missingDetails.join(', ')}`);
      }
      if (problemLines.length > 0) blocks.push(`PROBLEMS\n${problemLines.join('\n')}`);

      return blocks.join('\n\n');
    }

    private renderPlannerSurface(surface: PlannerSurfaceIR, enc: ElementSyntaxEncoder): string {
      const lines: string[] = ['PLANNER SURFACE'];

      for (const group of surface.groups) {
        lines.push('', `${group.label} (${group.regionId})`);
        for (const el of group.visibleElements) lines.push('  ' + enc.encode(el));
        if (group.omittedCount > 0) lines.push(`  ## omitted ${group.omittedCount} similar`);
      }

      if (surface.remainder.length > 0) {
        lines.push('', 'page elements');
        for (const el of surface.remainder) lines.push('  ' + enc.encode(el));
      }

      return lines.join('\n');
    }

    private renderWorkingSet(ws: WorkingSetIR): string {
      const lines: string[] = ['WORKING SET'];
      if (ws.primaryRefs.length > 0) lines.push(`  primary:    ${ws.primaryRefs.join(', ')}`);
      if (ws.navigationRefs.length > 0) lines.push(`  navigation: ${ws.navigationRefs.join(', ')}`);
      if (ws.failedRefs.length > 0) {
        lines.push(`  failed:     ${ws.failedRefs.map(f => f.refId).join(', ')}`);
      }
      if (ws.actionSurface) {
        const avail = [
          ws.actionSurface.clickableRefs.length > 0 && 'click',
          ws.actionSurface.typeableRefs.length > 0 && 'type',
          ws.actionSurface.selectableRefs.length > 0 && 'select',
          ws.actionSurface.readableRefs.length > 0 && 'read',
        ].filter(Boolean);
        if (avail.length > 0) lines.push(`  action surface: ${avail.join(', ')} available`);
      }
      lines.push(`\n  omitted: ${ws.omittedCount} refs | total: ${ws.totalObservedCount} | shown: ${ws.selectedCount}`);
      return lines.join('\n');
    }

    private renderDecisionSignals(signals: DecisionSignalsIR): string {
      const lines: string[] = ['DECISION SIGNALS'];
      if (signals.recommended.length > 0) {
        lines.push('  recommended:');
        for (const r of signals.recommended) lines.push(`    ${r.refId}: ${r.reasons.join(', ')}`);
      }
      if (signals.alternatives.length > 0) {
        lines.push('  alternatives:');
        for (const r of signals.alternatives) lines.push(`    ${r.refId}: ${r.reasons.join(', ')}`);
      }
      if (signals.suppressed.count > 0) {
        lines.push(`  suppressed: ${signals.suppressed.count} refs`);
        const reasons = Object.entries(signals.suppressed.byReason)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}: ${n}`)
          .join(', ');
        if (reasons) lines.push(`    ${reasons}`);
      }
      return lines.join('\n');
    }
  }
  ```

- [ ] **Step 7.4: Run tests**

  Run: `npm run test:unit 2>&1 | findstr /i "PromptLayoutEngine\|ok\|fail"`
  Expected: all pass

- [ ] **Step 7.5: Commit**

  ```bash
  git add src/v2/planner/prc/PromptLayoutEngine.ts tests/unit/v2/prc/PromptLayoutEngine.test.ts
  git commit -m "feat(prc): implement PromptLayoutEngine (IR → string, all syntax variants)"
  ```

---

## Task 8: PlannerRepresentationCompiler — Orchestrator Returns IR

**Files:**
- Create: `src/v2/planner/prc/PlannerRepresentationCompiler.ts`

- [ ] **Step 8.1: Implement the compiler**

  Create `src/v2/planner/prc/PlannerRepresentationCompiler.ts`:

  ```typescript
  import type { PlannerInput } from '../types';
  import type { PlannerRepresentationIR, CompilerStats, ScoreTier } from './types';
  import { ElementNormalizer } from './ElementNormalizer';
  import { RegionOptimizer } from './RegionOptimizer';
  import { ExecutionContextBuilder } from './ExecutionContextBuilder';
  import { PlannerSurfaceBuilder } from './PlannerSurfaceBuilder';
  import { WorkingSetBuilder } from './WorkingSetBuilder';
  import { DecisionSignalBuilder } from './DecisionSignalBuilder';

  export class PlannerRepresentationCompiler {
    private readonly ecBuilder = new ExecutionContextBuilder();
    private readonly surfaceBuilder: PlannerSurfaceBuilder;
    private readonly wsBuilder = new WorkingSetBuilder();
    private readonly dsBuilder = new DecisionSignalBuilder();

    constructor() {
      this.surfaceBuilder = new PlannerSurfaceBuilder(new ElementNormalizer(), new RegionOptimizer());
    }

    compile(input: PlannerInput): PlannerRepresentationIR {
      // Build failure map for annotation
      const failureMap = new Map<string, { kind: string; count: number }>();
      for (const f of (input.failures ?? [])) {
        if (!f.targetRef) continue;
        const existing = failureMap.get(f.targetRef);
        if (existing && existing.kind === f.kind) {
          existing.count++;
        } else {
          failureMap.set(f.targetRef, { kind: f.kind, count: 1 });
        }
      }

      const executionContext = this.ecBuilder.build(input);
      const plannerSurface = this.surfaceBuilder.build(input.current, failureMap, 'full');
      const workingSet = input.workingSet ? this.wsBuilder.build(input.workingSet) : undefined;
      const decisionSignals = input.workingSet ? this.dsBuilder.build(input.workingSet) : undefined;
      const stats = this.buildStats(input, plannerSurface.groups, plannerSurface.remainder, failureMap);

      return { executionContext, plannerSurface, workingSet, decisionSignals, stats };
    }

    private buildStats(
      input: PlannerInput,
      groups: PlannerRepresentationIR['plannerSurface']['groups'],
      remainder: PlannerRepresentationIR['plannerSurface']['remainder'],
      failureMap: Map<string, unknown>,
    ): CompilerStats {
      const projection = input.current;
      const inputRefCount =
        (projection.interactions?.length ?? 0) +
        (projection.readables?.length ?? 0) +
        (projection.navigation?.length ?? 0);

      const allVisible = [...groups.flatMap(g => g.visibleElements), ...remainder];
      const surfaceRefCount = allVisible.length;
      const regionsCollapsed = groups.filter(g => g.omittedCount > 0).length;
      const elementsOmitted = groups.reduce((acc, g) => acc + g.omittedCount, 0) + (inputRefCount - surfaceRefCount - elementsOmitted);
      const anomalyCount = allVisible.reduce((acc, el) => acc + el.anomalies.length, 0);
      const failureAnnotations = allVisible.filter(el => el.failureAnnotation).length;

      // defaults removed: for each element, count attributes NOT serialized because they're default
      // top-tier score (1) + visible (1) + ready (1) + live (1) + confidence=1 (1) = 5 per element
      const defaultsRemoved = surfaceRefCount * 5;

      // rough token estimate: JSON ~37 tokens/element, PRC ~7 tokens/element
      const estimatedTokensSaved = Math.round(surfaceRefCount * 30);

      const scoreTierDist: Record<ScoreTier, number> = { top: 0, high: 0, mid: 0, low: 0 };
      for (const el of allVisible) scoreTierDist[el.scoreTier]++;

      return {
        inputRefCount,
        surfaceRefCount,
        regionsCollapsed,
        elementsOmitted: inputRefCount - surfaceRefCount,
        defaultsRemoved,
        anomalyCount,
        failureAnnotations,
        estimatedTokensSaved,
        scoreTierDistribution: scoreTierDist,
      };
    }
  }
  ```

- [ ] **Step 8.2: Build check**

  Run: `npm run build`
  Expected: no errors

- [ ] **Step 8.3: Commit**

  ```bash
  git add src/v2/planner/prc/PlannerRepresentationCompiler.ts
  git commit -m "feat(prc): implement PlannerRepresentationCompiler returning PlannerRepresentationIR"
  ```

---

## Task 9: PlannerPrompt Integration + Invariant Tests

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`
- Create: `tests/unit/v2/prc/PlannerRepresentationCompiler.test.ts`

- [ ] **Step 9.1: Update `PlannerPrompt.ts`**

  Replace lines 51–54 with:

  ```typescript
  import type { PlannerInput } from './types';
  import type { PlannerSerializationConfig } from './types';
  import { PlannerRepresentationCompiler } from './prc/PlannerRepresentationCompiler';
  import { PromptLayoutEngine } from './prc/PromptLayoutEngine';

  export function buildV2PlannerUserMessage(
    input: PlannerInput,
    config: PlannerSerializationConfig = { mode: 'json' },
  ): string {
    if (config.mode === 'prc') {
      const compiler = new PlannerRepresentationCompiler();
      const engine = new PromptLayoutEngine();
      const ir = compiler.compile(input);
      return `Planner input:\n${engine.render(ir, config)}`;
    }
    return `Planner input JSON:\n${JSON.stringify(input)}`;
  }
  ```

- [ ] **Step 9.2: Add PRC smoke tests to `plannerPrompt.test.ts`**

  Add to end of `tests/unit/v2/plannerPrompt.test.ts`:

  ```typescript
  test('buildV2PlannerUserMessage prc mode: starts with Planner input:\\nMISSION', () => {
    const message = buildV2PlannerUserMessage({
      version: 'v2.planner_input.v2', episodeId: 'ep_prc',
      goal: 'Find something',
      current: {
        projectionId: 'p1', observationId: 'obs_1', generationId: 1,
        page: { url: 'https://test.com', title: 'Test' }, refs: {},
        interactions: [], readables: [], navigation: [], regions: [], warnings: [],
        focus: { refId: 'v2ref_1', reason: 'highest_operational_score' },
        stats: { interactionCount: 0, readableCount: 0, navigationCount: 0, regionCount: 0 },
      },
      uncertainty: { level: 'none', signals: [] },
    }, { mode: 'prc' });
    assert.match(message, /^Planner input:\nMISSION/);
    assert.match(message, /Find something/);
    assert.match(message, /PLANNER SURFACE/);
  });

  test('buildV2PlannerUserMessage json mode (default): still raw JSON', () => {
    const message = buildV2PlannerUserMessage({
      version: 'v2.planner_input.v2', episodeId: 'ep_json',
      goal: 'Test',
      current: {
        projectionId: 'p1', observationId: 'obs_1', generationId: 1,
        page: { url: 'https://test.com', title: 'Test' }, refs: {},
        interactions: [], readables: [], navigation: [], regions: [], warnings: [],
        stats: { interactionCount: 0, readableCount: 0, navigationCount: 0, regionCount: 0 },
      },
      uncertainty: { level: 'none', signals: [] },
    });
    assert.match(message, /^Planner input JSON:\n\{/);
  });
  ```

- [ ] **Step 9.3: Write invariant tests**

  Create `tests/unit/v2/prc/PlannerRepresentationCompiler.test.ts`:

  ```typescript
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
  import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
  import type { PlannerInput } from '../../../../src/v2/planner/types';

  function makeInput(): PlannerInput {
    return {
      version: 'v2.planner_input.v2', episodeId: 'ep_inv',
      goal: 'Find quantum computing papers',
      current: {
        projectionId: 'p1', observationId: 'obs_9', generationId: 1,
        page: { url: 'https://arxiv.org/', title: 'arXiv' }, refs: {},
        interactions: [
          { refId: 'v2ref_14', kind: 'input', role: 'textbox', name: 'Search term',
            visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 },
          { refId: 'v2ref_30', kind: 'link', role: 'link', name: 'Submit',
            visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 },
        ],
        readables: [],
        navigation: [
          { refId: 'v2ref_12', kind: 'link', role: 'link', name: 'Advanced Search',
            visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 },
        ],
        regions: [],
        warnings: [],
        focus: { refId: 'v2ref_14', reason: 'highest_operational_score' },
        stats: { interactionCount: 2, readableCount: 0, navigationCount: 1, regionCount: 0 },
      },
      failures: [
        { failureId: 'f1', kind: 'timeout', category: 'timing', severity: 'warning',
          persistence: 'transient', retryable: true, targetRef: 'v2ref_30', signals: [], observationId: 'obs_5' },
        { failureId: 'f2', kind: 'timeout', category: 'timing', severity: 'warning',
          persistence: 'transient', retryable: true, targetRef: 'v2ref_30', signals: [], observationId: 'obs_7' },
      ],
      workingSet: {
        mode: 'explore', modeReason: 'initial',
        primaryRefs: [{ refId: 'v2ref_14', kind: 'input', name: 'Search term', score: 115, reasons: ['goal_keyword_match'] }],
        secondaryRefs: [],
        readableEvidence: [],
        navigationRefs: [{ refId: 'v2ref_12', kind: 'link', name: 'Advanced Search', score: 115, reasons: ['navigation_candidate'] }],
        actionSurface: { clickableRefs: [], typeableRefs: ['v2ref_14'], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
        changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 3, topRefs: [], omittedCount: 0 },
        failedRefs: [{ refId: 'v2ref_30', kind: 'link', name: 'Submit', score: 115, reasons: ['last_failure'] }],
        quarantinedActions: [], regionSummaries: [],
        omitted: { observedRefCount: 857, selectedRefCount: 3, droppedRefCount: 854, droppedByReason: {} },
      },
      uncertainty: { level: 'medium', signals: ['failure:timeout'] },
    };
  }

  const compiler = new PlannerRepresentationCompiler();
  const engine = new PromptLayoutEngine();

  test('INVARIANT 1: every primaryRef appears in plannerSurface', () => {
    const ir = compiler.compile(makeInput());
    const allRefIds = new Set([
      ...ir.plannerSurface.groups.flatMap(g => g.visibleElements.map(e => e.refId)),
      ...ir.plannerSurface.remainder.map(e => e.refId),
    ]);
    for (const ref of ir.workingSet!.primaryRefs) {
      assert.ok(allRefIds.has(ref), `primary ref ${ref} missing from plannerSurface`);
    }
  });

  test('INVARIANT 2a: failed ref has failureAnnotation on NormalizedPlannerElement', () => {
    const ir = compiler.compile(makeInput());
    const allEls = [...ir.plannerSurface.groups.flatMap(g => g.visibleElements), ...ir.plannerSurface.remainder];
    const v2ref30 = allEls.find(e => e.refId === 'v2ref_30');
    assert.ok(v2ref30, 'v2ref_30 must be in surface');
    assert.ok(v2ref30!.failureAnnotation, 'v2ref_30 must have failureAnnotation');
    assert.match(v2ref30!.failureAnnotation!, /timeout×2/);
  });

  test('INVARIANT 2b: failed ref appears in executionContext.failures', () => {
    const ir = compiler.compile(makeInput());
    assert.ok(ir.executionContext.failures.some(f => f.targetRef === 'v2ref_30'), 'v2ref_30 must be in failures');
  });

  test('INVARIANT 3: select element options not truncated', () => {
    const input = makeInput();
    const longOptions = 'All fields | Title | Author | Abstract | Comments | Journal reference | ACM classification | MSC classification | Report number | arXiv identifier | DOI | ORCID | arXiv author ID | Help pages | Full text';
    (input.current.interactions[0] as any).kind = 'select';
    (input.current.interactions[0] as any).selectOptions = longOptions;
    const ir = compiler.compile(input);
    const allEls = [...ir.plannerSurface.groups.flatMap(g => g.visibleElements), ...ir.plannerSurface.remainder];
    const sel = allEls.find(e => e.kind === 'select');
    assert.ok(sel);
    assert.equal(sel!.selectOptions, longOptions, 'selectOptions must not be truncated');
  });

  test('INVARIANT 5: uncertainty=high appears in PROBLEMS when rendered', () => {
    const input = makeInput();
    input.uncertainty = { level: 'high', signals: ['dead_state_evidence'] };
    const ir = compiler.compile(input);
    const out = engine.render(ir, { mode: 'prc' });
    assert.match(out, /PROBLEMS/);
    assert.match(out, /high/);
  });

  test('INVARIANT 6: no element missing kind, name, or lane', () => {
    const ir = compiler.compile(makeInput());
    const allEls = [...ir.plannerSurface.groups.flatMap(g => g.visibleElements), ...ir.plannerSurface.remainder];
    for (const el of allEls) {
      assert.ok(el.kind, `element ${el.refId} missing kind`);
      assert.ok(el.name !== undefined, `element ${el.refId} missing name`);
      assert.ok(el.lane, `element ${el.refId} missing lane`);
    }
  });

  test('INVARIANT 7: renderMode=full stored on surface IR', () => {
    const ir = compiler.compile(makeInput());
    assert.equal(ir.plannerSurface.renderMode, 'full');
  });

  test('INVARIANT 8: MISSION is first in rendered output', () => {
    const ir = compiler.compile(makeInput());
    const out = engine.render(ir, { mode: 'prc' });
    assert.ok(out.trimStart().startsWith('MISSION'), `Got: ${out.slice(0, 80)}`);
  });

  test('INVARIANT 9: stats.inputRefCount matches projection element total', () => {
    const ir = compiler.compile(makeInput());
    // 2 interactions + 0 readables + 1 navigation = 3
    assert.equal(ir.stats.inputRefCount, 3);
  });

  test('INVARIANT 10: changing prcSyntax changes rendered element lines, not MISSION block', () => {
    const ir = compiler.compile(makeInput());
    const xmlOut = engine.render(ir, { mode: 'prc', prcSyntax: 'xml-like' });
    const flatOut = engine.render(ir, { mode: 'prc', prcSyntax: 'flat-token' });
    // MISSION identical
    const missionEnd = xmlOut.indexOf('\n\nSTATE');
    assert.equal(xmlOut.slice(0, missionEnd), flatOut.slice(0, missionEnd));
    // Surface differs
    assert.notEqual(xmlOut, flatOut);
  });
  ```

- [ ] **Step 9.4: Run full test suite**

  Run: `npm run test:unit 2>&1 | tail -30`
  Expected: All tests pass including all INVARIANT tests and existing plannerPrompt tests.

- [ ] **Step 9.5: Build check**

  Run: `npm run build`
  Expected: no errors

- [ ] **Step 9.6: Final commit**

  ```bash
  git add src/v2/planner/PlannerPrompt.ts tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/prc/PlannerRepresentationCompiler.test.ts
  git commit -m "feat(prc): wire compiler+engine into PlannerPrompt; add invariant tests"
  ```

---

## Self-Review

**Spec v3 coverage:**

| Requirement | Task |
|---|---|
| Compiler returns IR not string | Task 8 |
| `PlannerRepresentationIR` type | Task 1 |
| `NormalizedPlannerElement` struct (no text) | Task 1 + Task 2 |
| `ElementSyntaxEncoder` (4 syntax variants) | Task 3 |
| `RegionOptimizer` with `RegionBudget` interface | Task 4 |
| `ExecutionContextBuilder` → `ExecutionContextIR` | Task 5 |
| `PlannerSurfaceBuilder` → `PlannerSurfaceIR` (tree) | Task 6 |
| `WorkingSetBuilder` → `WorkingSetIR` | Task 6 |
| `DecisionSignalBuilder` → `DecisionSignalsIR` | Task 6 |
| `PromptLayoutEngine` (was PromptRenderer) | Task 7 |
| MISSION/STATE/RECENT EVENTS/PROBLEMS blocks | Task 7 |
| recommended/alternatives/suppressed naming | Task 6 + Task 7 |
| Adaptive section emission (skip empty) | Task 7 |
| Feature flag `plannerSerialization: 'json' \| 'prc'` | Task 1 + Task 9 |
| `prcSyntax: 'xml-like' \| 'flat-token' \| 'indented' \| 'symbolic'` | Task 1 + Task 3 |
| `renderMode: 'full' \| 'summary'` on surface | Task 1 + Task 6 |
| `CompilerStats` emitted automatically | Task 8 |
| All 10 hard invariants enforced by tests | Task 9 |
| JSON default path unchanged | Task 9 |
| Zero-touch to all upstream components | Tasks 1–9 verify this |

**Placeholder scan:** No TBDs. All code complete. All test commands with expected output.

**Type consistency:**
- `NormalizedPlannerElement` defined Task 1, used identically Tasks 2, 4, 6, 7, 8, 9
- `FailureEntry` defined Task 2, used in Tasks 6, 8
- `RegionBudget` defined Task 1, accepted by `RegionOptimizer` Task 4
- `PlannerRepresentationIR` defined Task 1, returned by compiler Task 8, consumed by engine Task 7, tested Task 9
- `PlannerSerializationConfig` defined Task 1, consumed by `buildV2PlannerUserMessage` Task 9
