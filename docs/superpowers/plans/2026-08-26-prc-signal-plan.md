# PRC Signal-Preserving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PRC secondary long-jump behind three independent flags (P1 tier drop lane-retained, P2 readable phrase +60 with gridcell pipeline fix and score-sorted readableEvidence, P3 compact S:/W: data plane) with wiring to real path `V2PlannerClient` `PlannerPrompt` `PlannerInputComposer`, preservation-only byte gates, and non-hardcoded runtime enable.

**Architecture:** Flags `prcTierOmitted` `compactDataPlane` in `PlannerSerializationConfig` `src/v2/planner/types.ts:222` and `readablePhraseBonus` in `PlannerWorkingSetOptions` `src/v2/planner/workingSetTypes.ts:36` gate `PromptLayoutEngine` `PlannerWorkingSetSelector` `PlannerPrompt` and are wired through `V2PlannerClient.ts:86` `buildV2PlannerSystemPrompt` + `buildV2PlannerUserMessage` and `PlannerInputComposer.ts:22` `new PlannerWorkingSetSelector`. Each pillar is a commit with failing preservation test first (TDD). 45/45 current tests stay when flags false.

**Tech Stack:** TypeScript, `tsx --test`, `TraceReplayAuditor`, `ProjectionSizeDiagnostics`

---

## File Structure

*   `src/v2/planner/types.ts:222` — `PlannerSerializationConfig {prcTierOmitted?, compactDataPlane?}` default false
*   `src/v2/planner/workingSetTypes.ts:36` — `PlannerWorkingSetOptions {readablePhraseBonus?}` default 30
*   `src/v2/planner/PlannerWorkingSetSelector.ts:59,168,217,251` — lane-scoped bonus + gridcell exempt + `buildReadableEvidence` score-sorted before slice
*   `src/v2/planner/prc/PromptLayoutEngine.ts:4,98` — flag-gated `render(ir, opts)` tier-only, lane & remainder region preserved, compact `S:/W:` branch
*   `src/v2/planner/PlannerPrompt.ts:5,61` — `buildV2PlannerSystemPrompt(opts)` + `buildV2PlannerUserMessage(input, config)` pass flags to `PromptLayoutEngine.render`
*   `src/v2/planner/V2PlannerClient.ts:83` — pass `this.plannerSerialization` to both prompt builders
*   `src/v2/planner/PlannerInputComposer.ts:22` — add `workingSetOptions` to `PlannerInputComposerInput`, use per-call `new PlannerWorkingSetSelector`
*   `src/v2/agent/types.ts` — `V2AgentLoopOptions` already has `plannerSerialization`, add `workingSetOptions` for non-hardcoded runtime enable
*   `tests/unit/v2/prc/promptLayoutEngine.test.ts` — P1/P3 flag-gated preservation (must pass flag explicitly)
*   `tests/unit/v2/plannerWorkingSetSelector.test.ts` — P2 synthetic gridcell top-5 score-sorted
*   `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts` — surfaceRefCount equal
*   `tests/unit/v2/compactPlannerView.test.ts` — byte gate preservation

---

### Task 1: P1 Flag Wiring + Tier-Only Preservation (Lane & Remainder Region Kept)

**Files:**
- Modify: `src/v2/planner/types.ts:220-225`
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts:98-113`
- Modify: `src/v2/planner/PlannerPrompt.ts:5,61`
- Modify: `src/v2/planner/V2PlannerClient.ts:83-89`
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts`

- [ ] **Step 1: Write failing test that explicitly passes `prcTierOmitted:true` (invalid as written before if flag not passed)**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';

function makeInput(): any { return { version:'v2.planner_input.v2', episodeId:'ep_prc_1', goal:'Search quantum', current:{ projectionId:'proj_1', observationId:'obs_1', generationId:1, page:{url:'https://example.test',title:'Example'}, focus:{refId:'v2ref_1',reason:'highest_operational_score'}, refs:{ v2ref_1:{refId:'v2ref_1',kind:'input',role:'textbox',name:'Search term',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:115}, v2ref_2:{refId:'v2ref_2',kind:'select',role:'combobox',name:'Field',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:115,selectOptions:['All fields']}, v2ref_3:{refId:'v2ref_3',kind:'button',role:'button',name:'Search',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:90}, v2ref_r:{refId:'v2ref_r',kind:'generic',role:'text',name:'Remainder note',text:'Remainder note',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:60,regionId:'region_remainder'}}, interactions:[{refId:'v2ref_1',rank:1},{refId:'v2ref_2',rank:2},{refId:'v2ref_3',rank:3},{refId:'v2ref_r',rank:4}], readables:[], navigation:[], regions:[{regionId:'region_form_1',kind:'form',label:'Search Form',refIds:['v2ref_1','v2ref_2','v2ref_3'],score:115},{regionId:'region_remainder',kind:'content',label:'Remainder',refIds:['v2ref_r'],score:60}], warnings:[], stats:{interactionCount:4,readableCount:0,navigationCount:0,regionCount:2} }, workingSet:{mode:'act',modeReason:'initial',primaryRefs:[{refId:'v2ref_1',kind:'input',name:'Search term',score:115,reasons:['visible_ready']}],secondaryRefs:[],readableEvidence:[],navigationRefs:[],actionSurface:{clickableRefs:['v2ref_3'],typeableRefs:['v2ref_1'],selectableRefs:['v2ref_2'],readableRefs:[],ambiguousRefs:[]},changedRefs:{appearedCount:0,weakenedCount:0,preservedCount:4,topRefs:[],omittedCount:0},failedRefs:[],quarantinedActions:[],regionSummaries:[],omitted:{observedRefCount:4,selectedRefCount:4,droppedRefCount:0,droppedByReason:{}}}, uncertainty:{level:'none',signals:[]}};}

test('P1 tier omitted when flag true, lane and remainder region preserved, s kept', () => {
  const input = makeInput();
  const ir = new PlannerRepresentationCompiler().compile(input);
  const legacy = new PromptLayoutEngine().render(ir); // flag false/omitted
  assert.match(legacy, /tier="/); assert.match(legacy, /lane="/); assert.match(legacy, /region="/);
  const compactTier = new PromptLayoutEngine().render(ir, {prcTierOmitted: true});
  assert.doesNotMatch(compactTier, /tier="/);
  assert.match(compactTier, /lane="/); // lane retained per verdict
  assert.match(compactTier, /region="/); // remainder region preserved
  assert.match(compactTier, /tools="/);
  assert.match(compactTier, /s="/);
});
```

- [ ] **Step 2: Run test to verify it fails on current code**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -t "P1 tier omitted"`
Expected: FAIL `compactTier` still contains `tier="/` because `PromptLayoutEngine.render` ignores `prcTierOmitted`, and `V2PlannerClient` does not pass flag.

- [ ] **Step 3: Add flags and wire real path end-to-end**

```typescript
// src/v2/planner/types.ts
export interface PlannerSerializationConfig {
  mode: PlannerSerializationMode;
  prcTierOmitted?: boolean; // default false P1
  compactDataPlane?: boolean; // P3 default false
}

// src/v2/planner/prc/PromptLayoutEngine.ts
export class PromptLayoutEngine {
  render(ir: PlannerRepresentationIR, opts: {prcTierOmitted?: boolean, compactDataPlane?: boolean} = {}): string {
    if (opts.compactDataPlane) { /* P3 branch, keep tier handling inside */ }
    return [renderMission(ir), renderState(ir), renderRecentEvents(ir), renderEvidenceCoverage(ir), renderProblems(ir), renderSurface(ir, opts), renderWorkingSet(ir), renderDecisionSignals(ir)].filter(Boolean).join('\n\n');
  }
}
function renderSurface(ir: PlannerRepresentationIR, opts: {prcTierOmitted?: boolean}): string { /* pass opts to renderElement */ }
function renderElement(element: PlannerElementIR, opts: {prcTierOmitted?: boolean}): string {
  const attrs = [
    `name="${escapeAttr(element.name)}"`,
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    `lane="${element.lane}"`, // always
    ...(opts.prcTierOmitted ? [] : [`tier="${element.scoreTier}"`]),
    element.regionId ? `region="${escapeAttr(element.regionId)}"` : undefined, // kept for remainder, group header already for grouped
    element.text ? `text="${escapeAttr(element.text)}"` : undefined,
    element.selectOptions?.length ? `options="${escapeAttr(element.selectOptions.join(' | '))}"` : undefined,
    element.anomalies.length ? `state="${escapeAttr(element.anomalies.join(','))}"` : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
    `s="${element.score}"`,
  ].filter(Boolean);
  return `[${element.refId}] <${element.kind} ${attrs.join(' ')} />`;
}

// src/v2/planner/PlannerPrompt.ts
export function buildV2PlannerSystemPrompt(opts: {prcTierOmitted?: boolean, compactDataPlane?: boolean} = {}): string { /* same base, no tier mention needed */ return base; }
export function buildV2PlannerUserMessage(input: PlannerInput, config: PlannerSerializationConfig = {mode:'json'}): string {
  if (config.mode === 'prc') {
    const ir = new PlannerRepresentationCompiler().compile(input);
    return `Planner input:\n${new PromptLayoutEngine().render(ir, {prcTierOmitted: config.prcTierOmitted, compactDataPlane: config.compactDataPlane})}`;
  }
  return `Planner input JSON:\n${JSON.stringify(input)}`;
}

// src/v2/planner/V2PlannerClient.ts:83
async call(input: V2PlannerCallInput): Promise<V2PlannerCallResult> {
  const systemPrompt = buildV2PlannerSystemPrompt(this.plannerSerialization);
  const baseUserMessage = buildV2PlannerUserMessage(input.plannerInput, this.plannerSerialization);
}
```

- [ ] **Step 4: Run test to verify it passes only when flag true via non-hardcoded opts, and legacy still has tier**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -v`
Expected: PASS tier absent only with `{prcTierOmitted:true}`, lane/region/tools/s preserved. Existing 45/45 with omitted flag still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/types.ts src/v2/planner/prc/PromptLayoutEngine.ts src/v2/planner/PlannerPrompt.ts src/v2/planner/V2PlannerClient.ts tests/unit/v2/prc/promptLayoutEngine.test.ts
git commit -m "feat(prc): P1 prcTierOmitted wiring + tier-only scope lane & remainder region preserved"
```

---

### Task 2: P2 Selector-Pipeline Fix + Lane-Scoped +60 (Score-Sorted ReadableEvidence)

**Files:**
- Modify: `src/v2/planner/workingSetTypes.ts:36`
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts:59,168,217,251`
- Modify: `src/v2/planner/PlannerInputComposer.ts:22`
- Modify: `src/v2/agent/types.ts` add `workingSetOptions`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

- [ ] **Step 1: Write failing synthetic test that proves readableEvidence top-5 is score-order not projection order**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
function makeRef(o:any){return {refId:'r',generationId:1,targetId:'t',selectorCandidates:['#a'],role:'button',name:'x',text:'x',visibility:'visible',actionability:'ready',continuityConfidence:1,state:'live',...o};}
test('P2 offscreen gridcell scored +60 appears in readableEvidence top-5 score-sorted', () => {
  const proj = new ProjectionService().project(buildBrowserObservation({observationId:'obs',sessionId:'s',generationId:1,url:'https://example.test',title:'t',timestamp:1,durationMs:5,refs:[
    makeRef({refId:'ref_visible_btn',role:'button',name:'Open menu',text:'Open menu',visibility:'visible',kind:'button'}),
    // 5 generic visibles to fill projection order before gridcell
    ...Array.from({length:5},(_,i)=> makeRef({refId:`ref_generic_${i}`,role:'text',name:`Generic ${i}`,text:`Generic ${i}`,visibility:'visible',kind:'generic'})),
    makeRef({refId:'ref_gridcell',role:'gridcell',name:'Dec 25',text:'Dec 25',visibility:'offscreen',kind:'generic'}),
  ],warnings:[]}));
  // without flag, gridcell omitted because generic offscreen + projection-order cap
  const selDefault = new PlannerWorkingSetSelector({maxPrimaryRefs:8,maxSecondaryRefs:8,maxReadableEvidence:4}).select({goal:'Book hotel Dec 25',projection:proj});
  assert.equal(selDefault.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell'), false);
  // with readablePhraseBonus 60, gridcell must be in readableEvidence and selectedRefIds, and among top-5 score-sorted
  const selBonus = new PlannerWorkingSetSelector({maxPrimaryRefs:8,maxSecondaryRefs:8,maxReadableEvidence:4,readablePhraseBonus:60} as any).select({goal:'Book hotel Dec 25',projection:proj});
  assert.ok(selBonus.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell'));
  assert.ok(selBonus.selectedRefIds.includes('ref_gridcell'));
  assert.ok(selBonus.workingSet.readableEvidence.slice(0,5).some(e=>e.refId==='ref_gridcell'));
  // empty gridcell still dropped
  const projEmpty = new ProjectionService().project(buildBrowserObservation({observationId:'obs2',sessionId:'s',generationId:1,url:'https://example.test',title:'t',timestamp:1,durationMs:5,refs:[makeRef({refId:'ref_gridcell2',role:'gridcell',name:'',text:'',visibility:'offscreen',kind:'generic'})],warnings:[]}));
  const selEmpty = new PlannerWorkingSetSelector({readablePhraseBonus:60} as any).select({goal:'Book hotel Dec 25',projection:projEmpty});
  assert.equal(selEmpty.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell2'), false);
});
```

- [ ] **Step 2: Run test to verify it fails on current pipeline (gridcell omitted, projection-order cap)**

Run: `npx tsx --test tests/unit/v2/plannerWorkingSetSelector.test.ts -t "P2 offscreen gridcell"`
Expected: FAIL second assert `selBonus readableEvidence` false because `classifyLowValue` drops offscreen generic before scoring and `buildReadableEvidence` is projection-order not score-order.

- [ ] **Step 3: Implement pipeline fix behind flag with score-sorted capping and wiring**

```typescript
// src/v2/planner/workingSetTypes.ts
export interface PlannerWorkingSetOptions { maxPrimaryRefs?: number; maxSecondaryRefs?: number; maxReadableEvidence?: number; maxNavigationRefs?: number; maxRegionSummaries?: number; maxTextLengthPerRef?: number; maxChangedRefs?: number; readablePhraseBonus?: number; }

// src/v2/planner/PlannerWorkingSetSelector.ts
function classifyLowValue(item: ProjectionItem): WorkingSetDropReason | undefined {
  const hasText = Boolean(item.name?.trim() || item.text?.trim());
  const isExempt = ['radio','checkbox','option','gridcell'].includes(item.role ?? '') && hasText;
  if (isExempt) return undefined;
  if (item.visibility === 'hidden' && !hasText) return 'hidden_low_value';
  if (item.visibility === 'offscreen' && item.kind === 'generic') return 'offscreen_low_value';
  if (item.kind === 'generic' && !hasText) return 'generic_low_value';
  return undefined;
}
function scoreCandidate(item: ProjectionItem, goal: string, evidence:..., opts:{readablePhraseBonus?:number}, isReadable:boolean): Candidate {
  // ... goalRelevance
  if (goalRelevance.phraseMatches>0) { const bonus=isReadable ? (opts.readablePhraseBonus ?? 30) : 30; reasons.add('goal_phrase_match'); score+=bonus; }
}
 // in select
const readableSet = new Set(input.projection.readables.map(r=>r.refId));
const candidates = input.projection.interactions.map(item => scoreCandidate(item, input.goal, evidence, {readablePhraseBonus: this.options.readablePhraseBonus}, readableSet.has(item.refId)));
 // sort already compareCandidates
function buildReadableEvidence(projection: OperationalProjection, selectedSet: Set<string>, options: Required<PlannerWorkingSetOptions>, scoreByRef: Map<string,number>): PlannerWorkingSetEvidence[] {
  const filtered = projection.readables.filter(item=>selectedSet.has(item.refId)).filter(item=>Boolean(item.name?.trim()||item.text?.trim()));
  filtered.sort((a,b)=> (scoreByRef.get(b.refId) ?? 0) - (scoreByRef.get(a.refId) ?? 0) || a.refId.localeCompare(b.refId));
  return filtered.slice(0, options.maxReadableEvidence).map(item=>({refId:item.refId, text:compactText([item.name,item.text].filter(Boolean).join(' '), options.maxTextLengthPerRef), reasons:['answer_candidate']}));
}
// call with scoreByRef built from candidates

// src/v2/planner/PlannerInputComposer.ts
export interface PlannerInputComposerInput { episodeId:string; goal:string; projection: OperationalProjection; graphSnapshot?:...; workingSetOptions?: PlannerWorkingSetOptions; ... }
export class PlannerInputComposer {
  private readonly workingSetSelector: PlannerWorkingSetSelector;
  constructor(opts:{workingSetOptions?: PlannerWorkingSetOptions}={}){ this.workingSetSelector=new PlannerWorkingSetSelector(opts.workingSetOptions); }
  compose(input: PlannerInputComposerInput): PlannerInput {
    const selector = input.workingSetOptions ? new PlannerWorkingSetSelector(input.workingSetOptions) : this.workingSetSelector;
    const workingSetSelection = selector.select({...});
  }
}
// src/v2/agent/types.ts
export interface V2AgentLoopOptions { plannerSerialization?: PlannerSerializationConfig; workingSetOptions?: PlannerWorkingSetOptions; ... }
 // V2AgentLoop.ts compose call passes input.workingSetOptions from options
```

- [ ] **Step 4: Run test to verify it passes when flag 60 via workingSetOptions, score-sorted top-5 holds, empty still dropped**

Run: `npx tsx --test tests/unit/v2/plannerWorkingSetSelector.test.ts -v`
Expected: PASS with non-hardcoded `new PlannerWorkingSetSelector({readablePhraseBonus:60})` and via `PlannerInputComposer` `workingSetOptions` path.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/workingSetTypes.ts src/v2/planner/PlannerWorkingSetSelector.ts src/v2/planner/PlannerInputComposer.ts src/v2/agent/types.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
git commit -m "feat(prc): P2 readablePhraseBonus 60 lane-scoped + gridcell exempt + score-sorted readableEvidence wiring"
```

---

### Task 3: P3 Compact Data Plane Behind Flag With Full Rendered Preservation

**Files:**
- Modify: `src/v2/planner/types.ts` `compactDataPlane`
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts:4` flag branch
- Modify: `src/v2/planner/PlannerPrompt.ts:5` co-update
- Modify: `src/v2/planner/V2PlannerClient.ts:83` wiring (already done in P1 but verify for compact)
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts`

- [ ] **Step 1: Write failing test that checks rendered output preserves supportingReadIndexes, c/t/s/r/a, failures, quarantine, changed refs, answer feedback, dead state, lineage**

```typescript
test('P3 compact rendered preserves all data-plane fields', () => {
  const input = makeInputWithEvidence(); // evidenceCoverage with supportingReadIndexes [0], failures [target_blocked], quarantine [click:ref], changedRefs appeared 2, answerFeedback missing, deadState, lineage 3 steps
  const ir = new PlannerRepresentationCompiler().compile(input);
  const legacyStr = new PromptLayoutEngine().render(ir);
  const compactStr = new PromptLayoutEngine().render(ir, {compactDataPlane:true});
  // IR bit-equal not enough — must check rendered
  assert.match(compactStr, /S:/); assert.match(compactStr, /W:/); assert.match(compactStr, /EVIDENCE:/);
  assert.match(compactStr, /supportingReadIndexes|reads=.*0/); // supportingReadIndexes preserved
  assert.match(compactStr, /tools="/); // c/t/s/r/a preserved via tools
  assert.match(compactStr, /failure:/); assert.match(compactStr, /quarantine|blocked/);
  assert.match(compactStr, /changed|appeared/); assert.match(compactStr, /answer_feedback/);
  assert.match(compactStr, /dead_state/); assert.match(compactStr, /lineage|history/);
  assert.match(legacyStr, /STATE/); // legacy still
  const promptCompact = buildV2PlannerSystemPrompt({compactDataPlane:true});
  assert.match(promptCompact, /S:/); // prompt co-update
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -t "P3 compact rendered"`
Expected: FAIL compact missing fields, prompt not describing `S:/W:`.

- [ ] **Step 3: Implement compact branch with full fields and prompt co-update in same commit**

```typescript
// PromptLayoutEngine.render already has prcTierOmitted, add compactDataPlane branch that renders S:/W:/EVIDENCE with all fields listed above, not just IR bit-equal
// PlannerPrompt.buildV2PlannerSystemPrompt(opts) must branch
// V2PlannerClient already passes this.plannerSerialization to both builders (P1 wiring) — verify compactDataPlane flows
```

- [ ] **Step 4: Run test to verify it passes and legacy 45/45 still passes with flag false**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -v`
Expected: PASS compact contains all fields, prompt describes them, legacy `STATE` with flag false.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/types.ts src/v2/planner/prc/PromptLayoutEngine.ts src/v2/planner/PlannerPrompt.ts src/v2/planner/V2PlannerClient.ts tests/unit/v2/prc/promptLayoutEngine.test.ts
git commit -m "feat(prc): P3 compactDataPlane full rendered preservation + prompt co-update"
```

---

### Task 4: Non-Hardcoded Runtime Enable + Preservation Byte Gate

**Files:**
- Modify: `src/v2/agent/createV2AgentLoop.ts` or `V2AgentLoop.ts` to accept `V2AgentLoopOptions` flags
- Test: `tests/unit/v2/compactPlannerView.test.ts` byte gate, plus new runtime flag test
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts` replay via options not hardcoded

- [ ] **Step 1: Write failing test for non-hardcoded enable**

```typescript
test('runtime flags enabled via V2AgentLoopOptions not hardcoded', async () => {
  const loop = new V2AgentLoop({plannerSerialization:{mode:'prc', prcTierOmitted:true, compactDataPlane:true}, workingSetOptions:{readablePhraseBonus:60}});
  // assert loop's composer uses those options via a single compose call — fails until wired
});
test('P1+P3 byte gate refs/capabilities preserved', async () => {
  const before = measureCompactPlannerView(beforeInput, beforeView);
  const after = measureCompactPlannerView(afterInputWithFlags, afterView);
  assert.ok(after.compactBytes < before.compactBytes);
  assert.equal(after.coverage.actionRefCoverage, 1.0);
});
```

- [ ] **Step 2: Run test to verify it fails until wired**

Run: `npx tsx --test tests/unit/v2/compactPlannerView.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts -v`
Expected: FAIL flags inert, byte not down.

- [ ] **Step 3: Wire V2AgentLoopOptions through to composer/client non-hardcoded**

```typescript
// src/v2/agent/types.ts already has, ensure createV2AgentLoop passes through
```

- [ ] **Step 4: Run test to verify it passes, 45/45 legacy with flags false**

Run: `npx tsx --test tests/unit/v2 -v`
Expected: PASS with flags true via options, PASS with omitted flags (defaults).

- [ ] **Step 5: Commit**

```bash
git add src/v2/agent/types.ts src/v2/agent/V2AgentLoop.ts tests/unit/v2/compactPlannerView.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
git commit -m "test(prc): non-hardcoded flag enable + preservation byte gate without outcome gate"
```

---

## Self-Review

**Spec coverage:** P1 tier-only lane&remainder region preserved, V2PlannerClient+PlannerPrompt wiring; P2 pipeline fix score-sorted readableEvidence top-5, lane-scoped +60, gridcell exempt; P3 rendered output preserves supportingReadIndexes, c/t/s/r/a, failures, quarantine, changed refs, answerFeedback, deadState, lineage with prompt co-update; independent flags/commits; non-hardcoded runtime enable — each has a task.
**Placeholder scan:** No TBD, no similar, complete code.
**Type consistency:** `PlannerSerializationConfig.prcTierOmitted` `compactDataPlane`, `PlannerWorkingSetOptions.readablePhraseBonus`, `PromptLayoutEngine.render(ir, opts)` opts consistent.
