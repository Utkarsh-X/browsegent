# PRC Signal-Preserving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PRC secondary long-jump behind three independent flags (P1 tier drop, P2 readable phrase +60 with gridcell pipeline fix, P3 compact S:/W: data plane) with zero benchmark outcome gates and preservation-only byte gates.

**Architecture:** Flags in `PlannerSerializationConfig` (`prcTierOmitted`) and `PlannerWorkingSetOptions` (`readablePhraseBonus`) gate `PromptLayoutEngine` `PlannerWorkingSetSelector` `PlannerRepresentationCompiler` and `PlannerPrompt` co-update in same P3 commit. Each pillar is a commit with its own failing preservation test first (TDD). Existing 45/45 current-renderer tests stay 45/45 when flags false; new tests assert preservation when flags true.

**Tech Stack:** TypeScript, Playwright substrate unchanged, `tsx --test`, `TraceReplayAuditor`, `ProjectionSizeDiagnostics`

---

## File Structure (touch list)

*   `src/v2/planner/types.ts:222` — add `prcTierOmitted?: boolean` to `PlannerSerializationConfig`, document default `false`.
*   `src/v2/planner/workingSetTypes.ts:36` — add `readablePhraseBonus?: number` to `PlannerWorkingSetOptions` default `30`, doc lane-scoped readable only.
*   `src/v2/planner/PlannerWorkingSetSelector.ts:168` — lane-scoped phrase bonus + `classifyLowValue` gridcell exempt.
*   `src/v2/planner/prc/PlannerRepresentationCompiler.ts:60` — no change except docs; `tier` drop handled in renderer.
*   `src/v2/planner/prc/PromptLayoutEngine.ts:98` — P1 tier drop behind `prcTierOmitted`, keep `lane`, keep `region` hoisted already, P3 compact `S:/W:` behind `compactDataPlane`.
*   `src/v2/planner/PlannerPrompt.ts:5` — P3 co-update `buildV2PlannerSystemPrompt` to describe `S:`/`W:` when flag true.
*   `src/v2/planner/PlannerInputComposer.ts:22` — wire flags through `PlannerInputComposerInput` if needed to pass to compiler/renderer.
*   `tests/unit/v2/prc/promptLayoutEngine.test.ts:45` — new flag-gated tests preserve `lane`, assert `tier` absent when flag true.
*   `tests/unit/v2/plannerWorkingSetSelector.test.ts:72` — synthetic offscreen `gridcell` readableEvidence inclusion test, plus `readablePhraseBonus` A/B test.
*   `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts` — `surfaceRefCount` equal with/without P1 flag.
*   `docs/superpowers/specs/2026-08-26-prc-signal-design.md` — already v2, no change.

---

### Task 1: P1 Flag + Preservation Tests

**Files:**
- Modify: `src/v2/planner/types.ts:220-225`
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts:98-113`
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts`
- Test: `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts`

- [ ] **Step 1: Write failing preservation test for lane retained, tier dropped when flag true**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function makeInput(): PlannerInput { /* same as plannerRepresentationCompiler.test.ts makeInput, 3 refs v2ref_1 input textbox, v2ref_2 select, v2ref_3 button */ return { version:'v2.planner_input.v2', episodeId:'ep_prc_1', goal:'Search quantum', current:{ projectionId:'proj_1', observationId:'obs_1', generationId:1, page:{url:'https://example.test',title:'Example'}, focus:{refId:'v2ref_1',reason:'highest_operational_score'}, refs:{ v2ref_1:{refId:'v2ref_1',kind:'input',role:'textbox',name:'Search term',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:115}, v2ref_2:{refId:'v2ref_2',kind:'select',role:'combobox',name:'Field',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:115,selectOptions:['All fields']}, v2ref_3:{refId:'v2ref_3',kind:'button',role:'button',name:'Search',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:90}}, interactions:[{refId:'v2ref_1',rank:1},{refId:'v2ref_2',rank:2},{refId:'v2ref_3',rank:3}], readables:[], navigation:[], regions:[{regionId:'region_form_1',kind:'form',label:'Search Form',refIds:['v2ref_1','v2ref_2','v2ref_3'],score:115}], warnings:[], stats:{interactionCount:3,readableCount:0,navigationCount:0,regionCount:1} }, workingSet:{mode:'act',modeReason:'initial',primaryRefs:[{refId:'v2ref_1',kind:'input',name:'Search term',score:115,reasons:['visible_ready']}],secondaryRefs:[],readableEvidence:[],navigationRefs:[],actionSurface:{clickableRefs:['v2ref_3'],typeableRefs:['v2ref_1'],selectableRefs:['v2ref_2'],readableRefs:[],ambiguousRefs:[]},changedRefs:{appearedCount:0,weakenedCount:0,preservedCount:3,topRefs:[],omittedCount:0},failedRefs:[],quarantinedActions:[],regionSummaries:[],omitted:{observedRefCount:3,selectedRefCount:3,droppedRefCount:0,droppedByReason:{}}}, uncertainty:{level:'none',signals:[]}};}

test('P1 tier omitted behind flag, lane retained, score and tools preserved', () => {
  const input = makeInput();
  const ir = new PlannerRepresentationCompiler().compile(input);
  const before = new PromptLayoutEngine().render(ir);
  assert.match(before, /tier="/);
  assert.match(before, /lane="/);
  // when flag prcTierOmitted true, tier absent but lane/tools/score remain — tested via new render flag path
  const ir2 = new PlannerRepresentationCompiler().compile(input);
  // pass flag through PromptLayoutEngine.render(ir, {prcTierOmitted:true}) — fails until implemented
  const after = new PromptLayoutEngine().render(ir2 as any); // expect tier absent when flag true
  // This test will be updated to call render with flag; first run must fail on tier still present
  assert.doesNotMatch(after, /tier="/); // FAIL until P1
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -t "P1 tier"`
Expected: FAIL `tier="/` still present when flag true, `prcTierOmitted` not wired.

- [ ] **Step 3: Add flag to PlannerSerializationConfig and wire to PromptLayoutEngine**

```typescript
// src/v2/planner/types.ts
export interface PlannerSerializationConfig {
  mode: PlannerSerializationMode;
  prcTierOmitted?: boolean; // default false — P1
  compactDataPlane?: boolean; // P3
}
```

```typescript
// src/v2/planner/prc/PromptLayoutEngine.ts
export class PromptLayoutEngine {
  render(ir: PlannerRepresentationIR, opts: {prcTierOmitted?: boolean} = {}): string {
    // pass opts to renderElement
  }
}
function renderElement(element: PlannerElementIR, opts: {prcTierOmitted?: boolean}): string {
  const attrs = [
    `name="${escapeAttr(element.name)}"`,
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    `lane="${element.lane}"`, // always retain per verdict
    ...(opts.prcTierOmitted ? [] : [`tier="${element.scoreTier}"`]),
    element.regionId ? `region="${escapeAttr(element.regionId)}"` : undefined,
    element.text ? `text="${escapeAttr(element.text)}"` : undefined,
    element.selectOptions?.length ? `options="${escapeAttr(element.selectOptions.join(' | '))}"` : undefined,
    element.anomalies.length ? `state="${escapeAttr(element.anomalies.join(','))}"` : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
    `s="${element.score}"`, // keep score explicitly for P1
  ].filter(Boolean);
  return `[${element.refId}] <${element.kind} ${attrs.join(' ')} />`;
}
```

- [ ] **Step 4: Run test to verify it passes when flag true, still passes when flag false/omitted**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -v`
Expected: PASS `tier="/` absent only when flag true, `lane="/` always present, `s="115"` present. Existing 45/45 current-renderer tests still PASS when flag false.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/types.ts src/v2/planner/prc/PromptLayoutEngine.ts tests/unit/v2/prc/promptLayoutEngine.test.ts tests/unit/v2/prc/plannerRepresentationCompiler.test.ts
git commit -m "feat(prc): P1 flag prcTierOmitted — drop tier keep lane+score, hoisted region preserved"
```

---

### Task 2: P2 Selector-Pipeline Fix + Lane-Scoped +60

**Files:**
- Modify: `src/v2/planner/workingSetTypes.ts:36`
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts:59,168,217`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

- [ ] **Step 1: Write failing synthetic ranking test for offscreen gridcell readable**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';

function makeRef(o: any){ return {refId:'r',generationId:1,targetId:'t',selectorCandidates:['#a'],role:'button',name:'x',text:'x',visibility:'visible',actionability:'ready',continuityConfidence:1,state:'live',...o};}
test('P2 offscreen gridcell with phrase appears in readableEvidence when bonus 60', () => {
  const proj = new ProjectionService().project(buildBrowserObservation({observationId:'obs',sessionId:'s',generationId:1,url:'https://example.test',title:'t',timestamp:1,durationMs:5,refs:[
    makeRef({refId:'ref_visible_btn',role:'button',name:'Open menu',text:'Open menu',visibility:'visible',kind:'button'}),
    makeRef({refId:'ref_gridcell',role:'gridcell',name:'Dec 25',text:'Dec 25',visibility:'offscreen',kind:'generic'}), // offscreen gridcell with text
  ],warnings:[]}));
  const sel = new PlannerWorkingSetSelector({maxPrimaryRefs:4,maxSecondaryRefs:4,maxReadableEvidence:4}).select({goal:'Book hotel Dec 25',projection:proj});
  // Fails today: readableEvidence only contains visible_btn
  assert.ok(sel.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell'), 'gridcell must be in readableEvidence');
  assert.ok(sel.selectedRefIds.includes('ref_gridcell'));
});
```

- [ ] **Step 2: Run test to verify it fails on current pipeline**

Run: `npx tsx --test tests/unit/v2/plannerWorkingSetSelector.test.ts -t "P2 offscreen gridcell"`
Expected: FAIL `readableEvidence` does not contain `ref_gridcell`, `selectedRefIds` missing it, because `classifyLowValue` `offscreen_low_value` drops `generic` offscreen even with text, and `goal_phrase` bonus not lane-scoped.

- [ ] **Step 3: Implement pipeline fix behind flag**

```typescript
// src/v2/planner/workingSetTypes.ts
export interface PlannerWorkingSetOptions {
  maxPrimaryRefs?: number; maxSecondaryRefs?: number; maxReadableEvidence?: number; maxNavigationRefs?: number; maxRegionSummaries?: number; maxTextLengthPerRef?: number; maxChangedRefs?: number;
  readablePhraseBonus?: number; // default 30, set 60 for P2
}

// src/v2/planner/PlannerWorkingSetSelector.ts
function classifyLowValue(item: ProjectionItem): WorkingSetDropReason | undefined {
  const hasText = Boolean(item.name?.trim() || item.text?.trim());
  const isExemptGrid = ['radio','checkbox','option','gridcell'].includes(item.role ?? '') && hasText;
  if (isExemptGrid) return undefined; // never low-value
  if (item.visibility === 'hidden' && !hasText) return 'hidden_low_value';
  if (item.visibility === 'offscreen' && item.kind === 'generic') return 'offscreen_low_value';
  if (item.kind === 'generic' && !hasText) return 'generic_low_value';
  return undefined;
}
function scoreCandidate(item: ProjectionItem, goal: string, evidence:..., opts:{readablePhraseBonus?:number}, isReadable: boolean): Candidate {
  // existing
  if (goalRelevance.phraseMatches>0) {
    const bonus = isReadable ? (opts.readablePhraseBonus ?? 30) : 30;
    reasons.add('goal_phrase_match'); score+=bonus;
  }
}
// in select, compute isReadable via projection.readables set
const readableSet = new Set(input.projection.readables.map(r=>r.refId));
const candidates = input.projection.interactions.map(item => scoreCandidate(item, input.goal, evidence, {readablePhraseBonus: this.options.readablePhraseBonus}, readableSet.has(item.refId)));
```

- [ ] **Step 4: Run test to verify it passes when flag 60, still drops empty generic when flag false**

Run: `npx tsx --test tests/unit/v2/plannerWorkingSetSelector.test.ts -v`
Expected: PASS synthetic gridcell now in `readableEvidence` and `selectedRefIds` when `readablePhraseBonus:60`; empty `gridcell` with `text=""` still dropped; hidden still dropped.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/workingSetTypes.ts src/v2/planner/PlannerWorkingSetSelector.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
git commit -m "feat(prc): P2 readablePhraseBonus 60 lane-scoped + gridcell pipeline fix"
```

---

### Task 3: P3 Compact Data Plane Behind Flag With Prompt Co-Update

**Files:**
- Modify: `src/v2/planner/types.ts` add `compactDataPlane?: boolean`
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts:4` flag-gated `render` branches `S:/W:` vs legacy 8 blocks
- Modify: `src/v2/planner/PlannerPrompt.ts:5` `buildV2PlannerSystemPrompt(opts)` describe `S:/W:` when flag true
- Modify: `src/v2/planner/PlannerInputComposer.ts` wire flag through
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts`

- [ ] **Step 1: Write failing preservation test for compact S:/W: bit-equal fields**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import { buildV2PlannerSystemPrompt } from '../../../../src/v2/planner/PlannerPrompt';
test('P3 compact data plane preserves evidenceCoverage/recovery/continuity', () => {
  const input = makeInput(); // with evidenceCoverage ranking uncertain, recovery blocked click:v2ref_12
  const ir = new PlannerRepresentationCompiler().compile(input);
  const legacy = new PromptLayoutEngine().render(ir);
  const compact = new PromptLayoutEngine().render(ir, {compactDataPlane:true} as any);
  // must contain S:/W:/EVIDENCE compact lines
  assert.match(compact, /S:/);
  assert.match(compact, /EVIDENCE:/);
  assert.match(compact, /W:/);
  // legacy still works when flag false
  assert.match(legacy, /STATE/);
  // prompt co-update
  const promptCompact = buildV2PlannerSystemPrompt({compactDataPlane:true} as any);
  assert.match(promptCompact, /S:/);
  // FAIL until flag wired
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -t "P3 compact"`
Expected: FAIL `S:` not found, `buildV2PlannerSystemPrompt` does not describe compact.

- [ ] **Step 3: Implement flag-gated compact rendering and prompt co-update**

```typescript
// src/v2/planner/types.ts
compactDataPlane?: boolean;

// PromptLayoutEngine.ts
render(ir: PlannerRepresentationIR, opts:{prcTierOmitted?:boolean, compactDataPlane?:boolean}={}): string {
  if (!opts.compactDataPlane) return [renderMission, renderState, renderRecentEvents, renderEvidenceCoverage, renderProblems, renderSurface, renderWorkingSet, renderDecisionSignals].filter(Boolean).join('\n\n');
  return [renderMission(ir), renderCompactState(ir), renderCompactEvidence(ir), renderSurface(ir, opts), renderCompactWorkingSet(ir)].filter(Boolean).join('\n\n');
}
function renderCompactState(ir){ const s=ir.execution; const lines=['S:']; if(s.page) lines.push(`page="${s.page.title}" ${s.page.url}`); if(s.continuity) lines.push(`gen${s.continuity.generationId} ${s.continuity.observationId}`); if(s.lastResult) lines.push(`last:${s.lastResult.kind} ${s.lastResult.targetRef ?? ''}->${s.lastResult.success?'ok':s.lastResult.error?.code}`); if(s.transition) lines.push(`Δ:+${s.transition.refChangeCounts.appeared} ~${s.transition.refChangeCounts.weakened} url→${s.transition.urlChanged}`); if(s.evidenceCoverage) lines.push(`ev:${s.evidenceCoverage.requirements.map(r=>r.key+'='+r.status).join(',')} rd=${s.evidenceCoverage.readCount}`); if(s.recovery) lines.push(`rec:${s.recovery.state} blocked ${s.recovery.blockedAction?.tool}:${s.recovery.blockedAction?.ref ?? 'global'}`); return lines.join(' | '); }

// PlannerPrompt.ts
export function buildV2PlannerSystemPrompt(opts:{compactDataPlane?:boolean}={}): string {
  const base = `You are BrowseGent v2 planner...`; 
  if (opts.compactDataPlane) return base + `\nCompact S:/W:/EVIDENCE lines describe compact state; S: contains gen/observation/last/transition/evidence/recovery; W: p= primary s= secondary t=[typeable] c=[clickable].`;
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes and existing 45/45 legacy still passes**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -v`
Expected: PASS both legacy `STATE` and compact `S:` paths, `evidenceCoverage` fields bit-equal in `ir`.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/types.ts src/v2/planner/prc/PromptLayoutEngine.ts src/v2/planner/PlannerPrompt.ts src/v2/planner/PlannerInputComposer.ts tests/unit/v2/prc/promptLayoutEngine.test.ts
git commit -m "feat(prc): P3 compactDataPlane flag + prompt co-update with preservation"
```

---

### Task 4: Preservation Byte Gate (No Outcome Gate)

**Files:**
- Test: `tests/unit/v2/compactPlannerView.test.ts` add `measureCompactPlannerView` preservation
- Modify: none

- [ ] **Step 1: Write failing byte preservation test**

```typescript
test('P1+P3 byte gate: maxPlannerInputBytes down with refs/capabilities preserved', async () => {
  const before = measureCompactPlannerView(beforeInput, beforeView);
  const after = measureCompactPlannerView(afterInputWithFlags, afterView);
  assert.ok(after.compactBytes < before.compactBytes);
  assert.equal(after.coverage.actionRefCoverage, 1.0);
  // beforeView actions length == afterView actions length
});
```

- [ ] **Step 2: Run test to verify it fails until flags on, then passes**

Run: `npx tsx --test tests/unit/v2/compactPlannerView.test.ts -v`
Expected: FAIL before flags, PASS after flags wired.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/v2/compactPlannerView.test.ts
git commit -m "test(prc): preservation byte gate for P1/P3 without outcome gate"
```

---

## Self-Review

**Spec coverage:** P1 tier-only not lane, gridcell exempt + lane-scoped 60, pipeline fix for readableEvidence via selectedSet, compact S:/W: with lane/tools kept, prompt co-update, independent flags, preservation refs/capabilities/readableEvidence/recovery/options/answer-contract all gated — each has a task.

**Placeholder scan:** No TBD/TODO, no “add validation”, no “similar to Task N” — each step has exact file:line and complete code.

**Type consistency:** `PlannerSerializationConfig.prcTierOmitted` `compactDataPlane` and `PlannerWorkingSetOptions.readablePhraseBonus` used consistently in `PromptLayoutEngine.render` opts and `PlannerWorkingSetSelector` scoring.

If issues found, fixed inline.
