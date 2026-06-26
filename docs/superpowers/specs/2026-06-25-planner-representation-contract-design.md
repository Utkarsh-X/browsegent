# Planner Representation Contract (PRC) Specification v3

**Date:** 2026-06-25
**Supersedes:** `prc_specification_v2.md`
**Status:** Approved — final architecture before implementation

---

## 1. The Central Framing: A Browser Reasoning Intermediate Language

PRC is not primarily a token optimization. It is a **browser reasoning intermediate language** (BRIL).

The compiler's job is to translate a raw `PlannerInput` into a structured intermediate representation — `PlannerRepresentationIR` — that captures what a reasoning agent needs to know about a browser state. That IR can then be consumed by:

| Consumer | Today | Future |
|---|---|---|
| LLM Planner | ✅ via `PromptLayoutEngine` | — |
| Debugger | — | reads IR directly |
| Replay viewer | — | renders IR as HTML |
| Evaluator | — | scores IR completeness |
| Telemetry pipeline | partial (stats) | full IR diffs |
| Fine-tuning dataset | — | IR as training signal |
| Explanation engine | — | IR → natural language |

**The compiler's interface is stable. The consumers can multiply without changing it.**

This is the architectural justification that outlasts any token savings figure.

---

## 2. Compiler Pipeline

```
Observation
    │
    ▼
OperationalProjection        (unchanged)
    │
    ▼
PlannerWorkingSetSelector    (unchanged)
    │
    ▼
PlannerInputComposer         (unchanged)
    │
    ▼
    PlannerInput  ← raw data object (IR input)
    │
    ▼
PlannerRepresentationCompiler   ← NEW
    │
    ├── ExecutionContextBuilder  → ExecutionContextIR
    ├── PlannerSurfaceBuilder    → PlannerSurfaceIR (tree, not string)
    │       └── ElementNormalizer  → NormalizedPlannerElement[]
    │       └── RegionOptimizer    → OptimizedSurface
    ├── WorkingSetBuilder        → WorkingSetIR
    ├── DecisionSignalBuilder    → DecisionSignalsIR
    │
    ▼
    PlannerRepresentationIR  ← structured IR (not a string)
    │
    ├── Used directly by: debugger, evaluator, replay viewer, telemetry
    │
    ▼
PromptLayoutEngine (was PromptRenderer)
    │
    ├── ElementSyntaxEncoder    → string per element (xml-like | flat-token | ...)
    │
    ▼
    string prompt
    │
    ▼
PlannerPrompt.buildV2PlannerUserMessage()
    │
    ▼
LLM
```

**The compiler returns `PlannerRepresentationIR`. The `PromptLayoutEngine` is one renderer of that IR, not part of the compiler.**

---

## 3. Core Type Definitions

### 3.1 `PlannerRepresentationIR` — the compiler's output

```typescript
interface PlannerRepresentationIR {
  executionContext: ExecutionContextIR;
  plannerSurface: PlannerSurfaceIR;
  workingSet: WorkingSetIR | undefined;
  decisionSignals: DecisionSignalsIR | undefined;
  stats: CompilerStats;
}
```

### 3.2 `CompilerStats` — telemetry emitted automatically

```typescript
interface CompilerStats {
  inputRefCount: number;         // total refs in projection
  surfaceRefCount: number;       // refs included in planner surface
  regionsCollapsed: number;      // how many regions were collapsed
  elementsOmitted: number;       // refs omitted from surface
  defaultsRemoved: number;       // attribute values elided (constant folding)
  anomalyCount: number;          // non-default values flagged
  failureAnnotations: number;    // [failed:X] annotations applied
  estimatedTokensSaved: number;  // rough estimate vs JSON baseline
  scoreTierDistribution: Record<'top' | 'high' | 'mid' | 'low', number>;
}
```

Stats are collected during compilation as a side effect. They attach to every IR and flow into telemetry, A/B reports, and regression detection.

### 3.3 `NormalizedPlannerElement` — structured, not text

```typescript
interface NormalizedPlannerElement {
  refId: string;
  kind: string;
  name: string;
  lane: 'interaction' | 'readable' | 'navigation';
  scoreTier: 'top' | 'high' | 'mid' | 'low';   // computed from raw score
  anomalies: ElementAnomaly[];                   // only non-defaults
  text?: string;                                 // only when text !== name
  selectOptions?: string;                        // full text, never truncated
  failureAnnotation?: string;                    // e.g. "timeout×2"
  regionId?: string;
}

type ElementAnomaly =
  | { kind: 'offscreen' }
  | { kind: 'hidden' }
  | { kind: 'blocked' }
  | { kind: 'disabled' }
  | { kind: 'confidence'; value: number }
  | { kind: 'state'; value: string };
```

`NormalizedPlannerElement` carries no syntax. It is pure data. `ElementSyntaxEncoder` (inside `PromptLayoutEngine`) converts it to text in the chosen syntax.

### 3.4 `PlannerSurfaceIR` — a tree, not a string

```typescript
interface PlannerSurfaceIR {
  groups: SurfaceRegionGroup[];    // elements grouped by region
  remainder: NormalizedPlannerElement[];  // ungrouped elements
  renderMode: 'full' | 'summary';
}

interface SurfaceRegionGroup {
  regionId: string;
  label: string;
  visibleElements: NormalizedPlannerElement[];
  omittedCount: number;
  totalCount: number;
}
```

This is the `SurfaceTree`. It enables progressive disclosure: a `'summary'` renderMode emits only group headers; an `inspect_region` call expands one group. The tree is pre-built; expansion is free.

### 3.5 `ExecutionContextIR`

```typescript
interface ExecutionContextIR {
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
```

### 3.6 `WorkingSetIR` and `DecisionSignalsIR`

```typescript
interface WorkingSetIR {
  primaryRefs: string[];
  navigationRefs: string[];
  failedRefs: Array<{ refId: string; kind: string }>;
  actionSurface: PlannerActionSurface | undefined;
  omittedCount: number;
  totalObservedCount: number;
  selectedCount: number;
}

interface DecisionSignalsIR {
  recommended: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  alternatives: Array<{ refId: string; reasons: WorkingSetIncludeReason[] }>;
  suppressed: {
    count: number;
    byReason: Partial<Record<WorkingSetDropReason, number>>;
    collapsedRegions: string[];
  };
}
```

**On Working Set / Decision Signals overlap:**
These layers answer different questions and must stay separate.
- `WorkingSetIR` = *operational* — which refs are in scope for the planner to act on now
- `DecisionSignalsIR` = *explanatory* — why each ref was selected, what was suppressed

The `primaryRefs` / `recommended` naming convergence is intentional: they refer to the same refs, but through different lenses. Working Set gives the planner its action surface. Decision Signals explains the reasoning behind it. Merging them would collapse an operational boundary into an explanatory one.

---

## 4. Information Layers (unchanged from v2)

### Layer 1 — Execution Context
Structured as: **MISSION / STATE / RECENT EVENTS / PROBLEMS**. Adaptive — blocks only emitted when they have content.

### Layer 2 — Planner Surface
`PlannerSurfaceIR` tree. Built by `PlannerSurfaceBuilder`, normalized by `ElementNormalizer`, grouped by `RegionOptimizer`. Rendered to text by `PromptLayoutEngine` using `ElementSyntaxEncoder`.

### Layer 3 — Working Set
Answers: *what refs are in scope?* Rendered from `WorkingSetIR`.

### Layer 4 — Decision Signals
Answers: *why?* Rendered from `DecisionSignalsIR`. Vocabulary: `recommended / alternatives / suppressed`.

---

## 5. RegionOptimizer: Count Now, Budget Later

The optimizer accepts a `RegionBudget` interface today. Only `maxElements` is implemented; `maxTokens` is a future upgrade path.

```typescript
interface RegionBudget {
  strategy: 'element-count' | 'token-budget';
  // element-count strategy (implemented now):
  maxElementsSmall: number;  // show all if region <= this (default: 5)
  maxElementsMedium: number; // show this many if 6-20 (default: 3)
  maxElementsLarge: number;  // show this many if >20 (default: 2)
  // token-budget strategy (future):
  maxRegionTokens?: number;
  maxSurfaceTokens?: number;
}
```

**Why not implement token-budget now:** Token-counting per element requires `js-tiktoken` at compile-time and adds ~5–20ms latency per compilation. The interface is stable; the implementation can be upgraded in a future plan without changing callers.

**Adaptive collapsing rules (element-count strategy):**

| Region size | Elements shown |
|---|---|
| ≤ 5 | All |
| 6–20 | 3 |
| > 20 | 2 |

---

## 6. ElementSyntaxEncoder: Multiple Syntax Variants

`ElementSyntaxEncoder` lives inside `PromptLayoutEngine`. It converts `NormalizedPlannerElement` → string in the configured syntax. It is the only place that changes when we benchmark syntax variants.

**Variants to benchmark:**

| Variant | Example |
|---|---|
| `xml-like` | `[v2ref_1] <link name="Docs" lane="interaction" />` |
| `flat-token` | `[v2ref_1] link "Docs" [interaction]` |
| `indented` | `[v2ref_1]\n  kind: link\n  name: Docs\n  lane: interaction` |
| `symbolic` | `[v2ref_1]:link:Docs:I` |

Config: `prcSyntax: 'xml-like' | 'flat-token' | 'indented' | 'symbolic'`

Changing `prcSyntax` changes only `ElementSyntaxEncoder`. No other component is affected. This makes syntax A/B trivial.

---

## 7. PromptLayoutEngine (was PromptRenderer)

`PromptLayoutEngine` owns:
- Ordering of the four layers
- Section headers and separators
- Adaptive section emission (skip empty layers)
- Calling `ElementSyntaxEncoder` per element
- Converting each IR struct to its text block

It does NOT own:
- What data goes in each layer (that's the builders)
- Element field normalization (that's `ElementNormalizer`)
- Element syntax (that's `ElementSyntaxEncoder`)

```typescript
class PromptLayoutEngine {
  render(ir: PlannerRepresentationIR, config: PlannerSerializationConfig): string;
}
```

---

## 8. Caching: Design Constraint (Not Implemented Now)

The IR structure enables incremental compilation:
- `ExecutionContextIR` changes every step (fast to rebuild)
- `PlannerSurfaceIR` only changes when the projection changes
- `WorkingSetIR` changes when working set selection changes
- `DecisionSignalsIR` changes when working set changes

A future `CachingPlannerRepresentationCompiler` can wrap the base compiler, diff `PlannerInput` snapshots, and return cached surface IR when the projection is unchanged. **This is a future plan.** The current implementation must not complicate internals to support caching — the IR architecture already makes caching straightforward to add.

---

## 9. Implementation Architecture

### New files
```
src/v2/planner/prc/
  types.ts                         — IR types: all interfaces defined here
  ElementNormalizer.ts             — SerializedProjectionRef → NormalizedPlannerElement
  ElementSyntaxEncoder.ts          — NormalizedPlannerElement → string (syntax variants)
  RegionOptimizer.ts               — adaptive grouping, RegionBudget interface
  ExecutionContextBuilder.ts       — PlannerInput → ExecutionContextIR
  PlannerSurfaceBuilder.ts         — OperationalProjection → PlannerSurfaceIR
  WorkingSetBuilder.ts             — PlannerWorkingSet → WorkingSetIR
  DecisionSignalBuilder.ts         — PlannerWorkingSet → DecisionSignalsIR
  PromptLayoutEngine.ts            — PlannerRepresentationIR → string
  PlannerRepresentationCompiler.ts — PlannerInput → PlannerRepresentationIR (orchestrator)

tests/unit/v2/prc/
  ElementNormalizer.test.ts
  ElementSyntaxEncoder.test.ts
  RegionOptimizer.test.ts
  ExecutionContextBuilder.test.ts
  PlannerSurfaceBuilder.test.ts
  WorkingSetBuilder.test.ts
  DecisionSignalBuilder.test.ts
  PromptLayoutEngine.test.ts
  PlannerRepresentationCompiler.test.ts  — invariants + integration
```

### Modified
```
src/v2/planner/types.ts           — add PlannerSerializationConfig, PlannerSerializationMode
src/v2/planner/PlannerPrompt.ts   — call compiler+engine when flag='prc'
tests/unit/v2/plannerPrompt.test.ts — prc smoke tests
```

### Unchanged
Everything else in `src/v2/`.

---

## 10. Hard Invariants (Enforced by Tests)

1. Every `workingSet.primaryRef.refId` appears in `plannerSurface.groups` or `plannerSurface.remainder`
2. Every `failures[].targetRef` has `failureAnnotation` on its `NormalizedPlannerElement` AND appears in `executionContext.failures`
3. No `NormalizedPlannerElement` with `kind=select` has truncated `selectOptions`
4. `executionContext.lastResult` is defined when `lastResult.success === false`
5. `executionContext.uncertainty.level === 'high'` → always rendered in PROBLEMS block
6. Every `NormalizedPlannerElement` has non-empty `kind`, `name`, and `lane`
7. `PlannerSurfaceBuilder` accepts `renderMode: 'full' | 'summary'`
8. Changing `prcSyntax` config changes `ElementSyntaxEncoder` output but not any IR type
9. `CompilerStats.inputRefCount === sum of projection interaction + readable + navigation counts`
10. `MISSION` block is always first in rendered prompt output
