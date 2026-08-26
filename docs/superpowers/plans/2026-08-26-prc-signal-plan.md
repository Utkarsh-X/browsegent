# PRC Signal-Preserving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PRC secondary long-jump behind three independent flags (P1 tier omission with lane retained, P2 opt-in readable phrase +60 with semantic-role handling and score-sorted readableEvidence, P3 compact S:/W: data plane) with wiring to the real `V2PlannerClient`/`PlannerPrompt`/`PlannerInputComposer` path, preservation-only byte gates, and non-hardcoded runtime enable.

**Architecture:** Add `prcTierOmitted` and `compactDataPlane` to `PlannerSerializationConfig` and `readablePhraseBonus` to `PlannerWorkingSetOptions`. Gate `PromptLayoutEngine`, `PlannerWorkingSetSelector`, and `PlannerPrompt`, then wire serialization through the existing `V2AgentLoopInput` path and working-set options through a new per-run input field. `BrowserAgentRunOptions`/`BrowserAgentRunner` must forward both controls. Do not put per-run planner controls in `V2AgentLoopOptions`, which is a construction/dependency type. Each pillar is a commit with a failing preservation test first (TDD). Existing behavior must remain unchanged when flags/options are omitted.

**Execution note:** The implementation and verification were completed in the working tree. Commits and staging were intentionally deferred, so the commit steps below remain unchecked.

**Tech Stack:** TypeScript, `tsx --test`, `TraceReplayAuditor`, `ProjectionSizeDiagnostics`

---

## File Structure

*   `src/v2/planner/types.ts:222` — `PlannerSerializationConfig {prcTierOmitted?, compactDataPlane?}` default false
*   `src/v2/planner/workingSetTypes.ts:36` — `PlannerWorkingSetOptions {readablePhraseBonus?}` default 30
*   `src/v2/planner/PlannerWorkingSetSelector.ts:59,168,214,251` — opt-in lane-scoped bonus + named semantic-role exemption + `buildReadableEvidence` score-sorted before slice
*   `src/v2/planner/prc/PromptLayoutEngine.ts:4,98` — flag-gated `render(ir, opts)` tier-only and compact data-plane branches
*   `src/v2/planner/PlannerPrompt.ts:5,61` — `buildV2PlannerSystemPrompt(opts)` + `buildV2PlannerUserMessage(input, config)` pass flags to `PromptLayoutEngine.render`
*   `src/v2/planner/V2PlannerClient.ts:83-89` — pass `this.plannerSerialization` to both prompt builders
*   `src/v2/planner/PlannerInputComposer.ts:27` — accept per-call `workingSetOptions` and select without shared mutable options
*   `src/v2/planner/prc/types.ts:67` — extend `WorkingSetIR` with readable evidence, changed refs, quarantine, and region summaries
*   `src/v2/planner/prc/PlannerRepresentationCompiler.ts:11` — copy those working-set fields into the IR
*   `src/v2/agent/types.ts:8` — add `workingSetOptions` to `V2AgentLoopInput`; leave `V2AgentLoopOptions` for construction dependencies
*   `src/v2/agent/V2AgentLoop.ts:85,643` — pass `input.workingSetOptions` to every composer call, including reconciliation/finalization
*   `src/v2/public/types.ts:28` + `src/v2/public/BrowserAgentRunner.ts:44` — expose and forward per-run working-set options
*   `tests/unit/v2/prc/promptLayoutEngine.test.ts` — exact P1/P3 rendered preservation and legacy-output tests
*   `tests/unit/v2/plannerWorkingSetSelector.test.ts` — P2 synthetic named-gridcell, normalized-role, and score-order tests
*   `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts` — IR field preservation tests
*   `tests/unit/v2/plannerPrompt.test.ts` — system/user prompt flag propagation tests

---

### Task 1: P1 Flag Wiring + Tier-Only Preservation (Lane & Remainder Region Kept)

**Files:**
- Modify: `src/v2/planner/types.ts:220-225`
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts:98-113`
- Modify: `src/v2/planner/PlannerPrompt.ts:5,61`
- Modify: `src/v2/planner/V2PlannerClient.ts:83-89`
- Verify: `src/v2/agent/types.ts:8-15` already carries `plannerSerialization` on the per-run `V2AgentLoopInput`
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts`

- [x] **Step 1: Write failing test that explicitly passes `prcTierOmitted:true` (invalid as written before if flag not passed)**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';

function makeInput(): any { return { version:'v2.planner_input.v2', episodeId:'ep_prc_1', goal:'Search quantum', current:{ projectionId:'proj_1', observationId:'obs_1', generationId:1, page:{url:'https://example.test',title:'Example'}, focus:{refId:'v2ref_1',reason:'highest_operational_score'}, refs:{ v2ref_1:{refId:'v2ref_1',kind:'input',role:'textbox',name:'Search term',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:115}, v2ref_2:{refId:'v2ref_2',kind:'select',role:'combobox',name:'Field',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:115,selectOptions:['All fields']}, v2ref_3:{refId:'v2ref_3',kind:'button',role:'button',name:'Search',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:90}, v2ref_r:{refId:'v2ref_r',kind:'generic',role:'text',name:'Remainder note',text:'Remainder note',visibility:'visible',actionability:'ready',state:'live',confidence:1,score:60,regionId:'region_remainder'}}, interactions:[{refId:'v2ref_1',rank:1},{refId:'v2ref_2',rank:2},{refId:'v2ref_3',rank:3},{refId:'v2ref_r',rank:4}], readables:[], navigation:[], regions:[{regionId:'region_form_1',kind:'form',label:'Search Form',refIds:['v2ref_1','v2ref_2','v2ref_3'],score:115}], warnings:[], stats:{interactionCount:4,readableCount:0,navigationCount:0,regionCount:1} }, workingSet:{mode:'act',modeReason:'initial',primaryRefs:[{refId:'v2ref_1',kind:'input',name:'Search term',score:115,reasons:['visible_ready']}],secondaryRefs:[],readableEvidence:[],navigationRefs:[],actionSurface:{clickableRefs:['v2ref_3'],typeableRefs:['v2ref_1'],selectableRefs:['v2ref_2'],readableRefs:[],ambiguousRefs:[]},changedRefs:{appearedCount:0,weakenedCount:0,preservedCount:4,topRefs:[],omittedCount:0},failedRefs:[],quarantinedActions:[],regionSummaries:[],omitted:{observedRefCount:4,selectedRefCount:4,droppedRefCount:0,droppedByReason:{}}}, uncertainty:{level:'none',signals:[]}};}

test('P1 tier omitted when flag true, lane and remainder region preserved, s kept', () => {
  const input = makeInput();
  const ir = new PlannerRepresentationCompiler().compile(input);
  const legacy = new PromptLayoutEngine().render(ir); // flag false/omitted
  const legacyExplicit = new PromptLayoutEngine().render(ir, {prcTierOmitted: false});
  assert.equal(legacy, legacyExplicit); // default output is byte-equivalent
  assert.match(legacy, /tier="/); assert.match(legacy, /lane="/);
  assert.match(legacy, /region="region_remainder"/);
  assert.doesNotMatch(legacy, / s="/); // score shorthand is flagged-only
  const compactTier = new PromptLayoutEngine().render(ir, {prcTierOmitted: true});
  assert.doesNotMatch(compactTier, /tier="/);
  assert.match(compactTier, /lane="/); // lane retained per verdict
  assert.match(compactTier, /region="region_remainder"/); // remainder region preserved
  assert.match(compactTier, /tools="/);
  assert.match(compactTier, /s="/);
  assert.equal((legacy.match(/\[v2ref_/g) ?? []).length, (compactTier.match(/\[v2ref_/g) ?? []).length);
});
```

- [x] **Step 2: Run test to verify it fails on current code**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -t "P1 tier omitted"`
Expected: FAIL `compactTier` still contains `tier="/` because `PromptLayoutEngine.render` ignores `prcTierOmitted`, and `V2PlannerClient` does not pass flag.

- [x] **Step 3: Add flags and wire real path end-to-end**

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
    ...(opts.prcTierOmitted ? [`s="${element.score}"`] : []),
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

- [x] **Step 4: Run test to verify it passes only when flag true via non-hardcoded opts, and legacy still has tier**

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
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

- [x] **Step 1: Write failing synthetic test that proves the opt-in semantic-role exemption and readableEvidence cap are correct**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
function makeRef(o:any){return {refId:'r',generationId:1,targetId:'t',selectorCandidates:['#a'],role:'button',name:'x',text:'x',visibility:'visible',actionability:'ready',continuityConfidence:1,state:'live',...o};}
test('P2 offscreen gridcell scored +60 appears within score-sorted readableEvidence cap', () => {
  const proj = new ProjectionService().project(buildBrowserObservation({observationId:'obs',sessionId:'s',generationId:1,url:'https://example.test',title:'t',timestamp:1,durationMs:5,refs:[
    makeRef({refId:'ref_visible_btn',role:'button',name:'Open menu',text:'Open menu',visibility:'visible',kind:'button'}),
    // 5 generic visibles to fill projection order before gridcell
    ...Array.from({length:5},(_,i)=> makeRef({refId:`ref_generic_${i}`,role:'text',name:`Generic ${i}`,text:`Generic ${i}`,visibility:'visible',kind:'generic'})),
    makeRef({refId:'ref_gridcell',role:'gridcell',name:'Dec 25',text:'Dec 25',visibility:'offscreen',kind:'generic'}),
  ],warnings:[]}));
   // without the option, gridcell remains excluded by the existing generic/offscreen policy
  const selDefault = new PlannerWorkingSetSelector({maxPrimaryRefs:8,maxSecondaryRefs:8,maxReadableEvidence:4}).select({goal:'Book hotel Dec 25',projection:proj});
  assert.equal(selDefault.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell'), false);
   // with readablePhraseBonus 60, gridcell must be in readableEvidence and selectedRefIds, and within the configured cap in score order
   const selBonus = new PlannerWorkingSetSelector({maxPrimaryRefs:8,maxSecondaryRefs:8,maxReadableEvidence:4,readablePhraseBonus:60}).select({goal:'Book hotel Dec 25',projection:proj});
  assert.ok(selBonus.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell'));
  assert.ok(selBonus.selectedRefIds.includes('ref_gridcell'));
  assert.ok(selBonus.workingSet.readableEvidence.slice(0,4).some(e=>e.refId==='ref_gridcell'));
  // empty gridcell still dropped
  const projEmpty = new ProjectionService().project(buildBrowserObservation({observationId:'obs2',sessionId:'s',generationId:1,url:'https://example.test',title:'t',timestamp:1,durationMs:5,refs:[makeRef({refId:'ref_gridcell2',role:'gridcell',name:'',text:'',visibility:'offscreen',kind:'generic'})],warnings:[]}));
  const selEmpty = new PlannerWorkingSetSelector({readablePhraseBonus:60}).select({goal:'Book hotel Dec 25',projection:projEmpty});
  assert.equal(selEmpty.workingSet.readableEvidence.some(e=>e.refId==='ref_gridcell2'), false);
});
```

- [x] **Step 2: Run test to verify it fails on current pipeline (gridcell omitted, projection-order cap)**

Run: `npx tsx --test tests/unit/v2/plannerWorkingSetSelector.test.ts -t "P2 offscreen gridcell"`
Expected: FAIL second assert `selBonus readableEvidence` false because `classifyLowValue` drops offscreen generic before scoring and `buildReadableEvidence` is projection-order not score-order.

- [x] **Step 3: Implement pipeline fix behind flag with score-sorted capping and wiring**

```typescript
// src/v2/planner/workingSetTypes.ts
export interface PlannerWorkingSetOptions { maxPrimaryRefs?: number; maxSecondaryRefs?: number; maxReadableEvidence?: number; maxNavigationRefs?: number; maxRegionSummaries?: number; maxTextLengthPerRef?: number; maxChangedRefs?: number; readablePhraseBonus?: number; }

// src/v2/planner/PlannerWorkingSetSelector.ts
function classifyLowValue(item: ProjectionItem, allowSemanticOffscreen = false): WorkingSetDropReason | undefined {
  const hasText = Boolean(item.name?.trim() || item.text?.trim());
  const normalizedRole = item.role?.trim().toLowerCase();
  const isExempt = allowSemanticOffscreen
    && ['radio','checkbox','option','gridcell'].includes(normalizedRole ?? '')
    && hasText;
  if (isExempt) return undefined;
  if (item.visibility === 'hidden' && !hasText) return 'hidden_low_value';
  if (item.visibility === 'offscreen' && item.kind === 'generic') return 'offscreen_low_value';
  if (item.kind === 'generic' && !hasText) return 'generic_low_value';
  return undefined;
}
function scoreCandidate(item: ProjectionItem, goal: string, evidence:..., opts:{readablePhraseBonus?:number}, isReadable:boolean, allowSemanticOffscreen:boolean): Candidate {
  // ... goalRelevance
  if (goalRelevance.phraseMatches>0) { const bonus=isReadable ? (opts.readablePhraseBonus ?? 30) : 30; reasons.add('goal_phrase_match'); score+=bonus; }
}
 // in select
const readableSet = new Set(input.projection.readables.map(r=>r.refId));
const candidates = input.projection.interactions.map(item => scoreCandidate(
  item,
  input.goal,
  evidence,
  { readablePhraseBonus: this.options.readablePhraseBonus },
  readableSet.has(item.refId),
  this.options.readablePhraseBonus !== undefined,
));
// Keep the existing interaction candidate pool. ProjectionService currently includes
// every observed ref there; do not add a second unbounded readables pool.
// Sort candidates with the existing compareCandidates before selecting primary/secondary;
// retain a scoreByRef map or selected candidate order for readable-evidence sorting.
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
  constructor(){ this.workingSetSelector=new PlannerWorkingSetSelector(); }
  compose(input: PlannerInputComposerInput): PlannerInput {
    const selector = input.workingSetOptions ? new PlannerWorkingSetSelector(input.workingSetOptions) : this.workingSetSelector;
const workingSetSelection = selector.select({...});
  }
}
```

- [x] **Step 4: Run test to verify it passes when flag 60 via workingSetOptions, score-sorted top-5 holds, empty still dropped**

Run: `npx tsx --test tests/unit/v2/plannerWorkingSetSelector.test.ts -v`
Expected: PASS with non-hardcoded `new PlannerWorkingSetSelector({readablePhraseBonus:60})` and via `PlannerInputComposer` `workingSetOptions` path.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/workingSetTypes.ts src/v2/planner/PlannerWorkingSetSelector.ts src/v2/planner/PlannerInputComposer.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
git commit -m "feat(prc): P2 readablePhraseBonus 60 lane-scoped + gridcell exempt + score-sorted readableEvidence wiring"
```

---

### Task 3: P3 Compact Data Plane Behind Flag With Full Rendered Preservation

**Files:**
- Modify: `src/v2/planner/types.ts` `compactDataPlane`
- Modify: `src/v2/planner/prc/types.ts:67` add the working-set fields required by the renderer
- Modify: `src/v2/planner/prc/PlannerRepresentationCompiler.ts:11` copy those fields into `WorkingSetIR`
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts:4` flag branch
- Modify: `src/v2/planner/PlannerPrompt.ts:5` co-update
- Modify: `src/v2/planner/V2PlannerClient.ts:83-89` wiring (already done in P1 but verify for compact)
- Test: `tests/unit/v2/prc/promptLayoutEngine.test.ts` exact rendered preservation
- Test: `tests/unit/v2/prc/plannerRepresentationCompiler.test.ts` IR field preservation

- [x] **Step 1: Write failing test that checks rendered output preserves supportingReadIndexes, c/t/s/r/a, failures, quarantine, changed refs, answer feedback, dead state, lineage**

```typescript
const requiredRenderedSentinels = [
  /sentinel_requirement/, /reads=17/, /sentinel-c-ref/, /tools="c,t,s,r,a"/,
  /sentinel_failure/, /sentinel-quarantine-tool/, /appeared=23/, /sentinel_changed_ref/,
  /sentinel_missing_detail/, /sentinel_previous_answer/, /sentinel_instruction/, /sentinel_dead_reason/,
  /sentinel_failure_kind/, /total=7/, /sentinel_last_lineage_ref/,
];

test('P3 compact rendered preserves all data-plane fields', () => {
  const input = makeInputWithUniqueSentinels();
  const ir = new PlannerRepresentationCompiler().compile(input);
  const legacyStr = new PromptLayoutEngine().render(ir);
  const compactStr = new PromptLayoutEngine().render(ir, {compactDataPlane:true});

  assert.match(compactStr, /S:/); assert.match(compactStr, /W:/); assert.match(compactStr, /EVIDENCE:/);
  assert.match(compactStr, /sentinel_requirement/); assert.match(compactStr, /reads=17/);
  assert.match(compactStr, /sentinel-c-ref/); assert.match(compactStr, /tools="c,t,s,r,a"/);
  assert.match(compactStr, /sentinel_failure/); assert.match(compactStr, /sentinel-quarantine-tool/);
  assert.match(compactStr, /appeared=23/); assert.match(compactStr, /sentinel_changed_ref/);
  assert.match(compactStr, /sentinel_missing_detail/); assert.match(compactStr, /sentinel_previous_answer/); assert.match(compactStr, /sentinel_instruction/);
  assert.match(compactStr, /sentinel_dead_reason/); assert.match(compactStr, /sentinel_failure_kind/);
  assert.match(compactStr, /total=7/); assert.match(compactStr, /sentinel_last_lineage_ref/);
  assert.match(legacyStr, /STATE/); assert.match(legacyStr, /WORKING SET/);

  const promptCompact = buildV2PlannerSystemPrompt({compactDataPlane:true});
  assert.match(promptCompact, /S:/); assert.match(promptCompact, /W:/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -t "P3 compact rendered"`
Expected: FAIL compact missing fields, prompt not describing `S:/W:`.

- [x] **Step 3: Implement compact branch with full fields and prompt co-update in same commit**

```typescript
// src/v2/planner/prc/types.ts
import type {
  PlannerChangedRefsSummary,
  PlannerQuarantinedAction,
  PlannerWorkingSetEvidence,
  PlannerWorkingSetRegionSummary,
} from '../workingSetTypes';
export interface WorkingSetIR {
  // existing fields...
  readableEvidence: PlannerWorkingSetEvidence[];
  changedRefs: PlannerChangedRefsSummary;
  quarantinedActions: PlannerQuarantinedAction[];
  regionSummaries: PlannerWorkingSetRegionSummary[];
}

// PlannerRepresentationCompiler.buildWorkingSet copies each field from PlannerWorkingSet,
// preserving array order and bounded values without re-deriving or dropping them.
// PromptLayoutEngine.render(..., {compactDataPlane:true}) emits bounded compact sections:
// EVIDENCE keeps requirement keys/status/supporting read indexes;
// W keeps refs, per-ref tools c/t/s/r/a, readable evidence, changed counts/top refs,
// failures, quarantine, regions, and omitted counts;
// PROBLEMS keeps answer feedback, dead state, recovery, and failure diagnostics;
// LAST keeps bounded lineage total/truncation and the last step summary.
// PlannerPrompt.buildV2PlannerSystemPrompt(opts) documents these exact compact markers only when enabled;
// the no-argument/default output remains the existing system prompt.
// V2PlannerClient passes this.plannerSerialization to both builders.
```

- [x] **Step 4: Run focused test to verify it passes and legacy rendering remains unchanged with flag false; repository-wide suite has one unrelated pre-existing adapter assertion failure**

Run: `npx tsx --test tests/unit/v2/prc/promptLayoutEngine.test.ts -v`
Expected: PASS compact contains all fields, prompt describes them, legacy `STATE` with flag false.

- [ ] **Step 5: Commit**

```bash
git add src/v2/planner/types.ts src/v2/planner/prc/types.ts src/v2/planner/prc/PlannerRepresentationCompiler.ts src/v2/planner/prc/PromptLayoutEngine.ts src/v2/planner/PlannerPrompt.ts src/v2/planner/V2PlannerClient.ts tests/unit/v2/prc/promptLayoutEngine.test.ts tests/unit/v2/prc/plannerRepresentationCompiler.test.ts
git commit -m "feat(prc): P3 compactDataPlane full rendered preservation + prompt co-update"
```

---

### Task 4: Non-Hardcoded Runtime Enable + Preservation Byte Gate

**Files:**
- Modify: `src/v2/agent/types.ts:8-15` add `workingSetOptions` to `V2AgentLoopInput`
- Modify: `src/v2/agent/V2AgentLoop.ts:85,643` forward per-run options to every composer call
- Modify: `src/v2/public/types.ts:28-37` add public `workingSetOptions`
- Modify: `src/v2/public/BrowserAgentRunner.ts:44-51` forward public options
- Test: `tests/unit/v2/publicAgentRunner.test.ts` for public-runner forwarding
- Test: `tests/unit/v2/plannerPrompt.test.ts` actual PRC user-message byte gate

- [x] **Step 1: Write failing test for non-hardcoded enable**

```typescript
test('public per-run planner options reach the loop input', async () => {
  let received: V2AgentLoopInput | undefined;
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 1,
    defaultModel: 'test-model',
    defaultTraceDir: 'trace',
    runtimeHeaded: false,
    loopFactory: () => ({run: async input => {
      received = input;
      return {success: false, value: '', steps: 0, metrics: {plannerCalls:0,inputTokens:0,outputTokens:0,plannerDurationMs:0,toolExecutions:0}};
    }}),
  });
  await runner.run('test task', {
    url: 'https://example.test',
    plannerSerialization: {mode:'prc', prcTierOmitted:true, compactDataPlane:true},
    workingSetOptions: {readablePhraseBonus:60},
  });
  assert.deepEqual(received?.plannerSerialization, {mode:'prc', prcTierOmitted:true, compactDataPlane:true});
  assert.deepEqual(received?.workingSetOptions, {readablePhraseBonus:60});
});
test('compact PRC user message is smaller without losing rendered fields', () => {
  const input = makeInputWithUniqueSentinels();
  const legacy = buildV2PlannerUserMessage(input, {mode:'prc', prcTierOmitted:false, compactDataPlane:false});
  const compact = buildV2PlannerUserMessage(input, {mode:'prc', prcTierOmitted:false, compactDataPlane:true});
  assert.ok(Buffer.byteLength(compact, 'utf8') < Buffer.byteLength(legacy, 'utf8'));
  for (const sentinel of requiredRenderedSentinels) assert.match(compact, sentinel);
});
```

- [x] **Step 2: Run tests to verify they fail until wired**

Run: `npx tsx --test tests/unit/v2/publicAgentRunner.test.ts tests/unit/v2/plannerPrompt.test.ts -v`
Expected: FAIL because public `workingSetOptions` is not forwarded and the compact PRC renderer is not yet implemented.

- [x] **Step 3: Wire per-run input through to the composer non-hardcoded**

```typescript
// src/v2/agent/types.ts
import type { PlannerWorkingSetOptions } from '../planner/workingSetTypes';
export interface V2AgentLoopInput {
  // existing fields...
  plannerSerialization?: PlannerSerializationConfig;
  workingSetOptions?: PlannerWorkingSetOptions;
}

// src/v2/public/types.ts has the corresponding public field.
// BrowserAgentRunner copies options.workingSetOptions into loop.run(...).
// V2AgentLoop passes input.workingSetOptions to both its normal and reconciliation
// PlannerInputComposer.compose calls. Do not add these fields to V2AgentLoopOptions.
```

- [x] **Step 4: Run focused tests to verify forwarding and legacy defaults; repository-wide suite has one unrelated pre-existing adapter assertion failure**

Run: `npx tsx --test tests/unit/v2/publicAgentRunner.test.ts tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/prc/*.test.ts`
Expected: PASS with flags/options explicitly supplied, PASS with all flags/options omitted, and compact PRC user bytes lower than legacy PRC bytes for the same fixture.

- [ ] **Step 5: Commit**

```bash
git add src/v2/agent/types.ts src/v2/agent/V2AgentLoop.ts src/v2/public/types.ts src/v2/public/BrowserAgentRunner.ts tests/unit/v2/publicAgentRunner.test.ts tests/unit/v2/plannerPrompt.test.ts
git commit -m "test(prc): non-hardcoded flag enable + preservation byte gate without outcome gate"
```

---

## Self-Review

**Spec coverage:** P1 tier omission with lane/remainder-region preservation and default byte-equivalence; P2 opt-in candidate-pool/pipeline fix with normalized roles and score-sorted readable evidence; P3 rendered preservation of supportingReadIndexes, c/t/s/r/a, failures, quarantine, changed refs, answerFeedback, deadState, lineage with compiler/IR updates; independent flags/commits; and public per-run runtime forwarding — each has a task.
**Safety boundaries:** No website/task/model hardcoding, no fixed benchmark outcome gate, no fixed savings promise, no live benchmark instruction, and no mutation of unrelated worktree files.
**Type/path consistency:** `PlannerSerializationConfig` owns serialization flags; `PlannerWorkingSetOptions` owns selector options; `V2AgentLoopInput` and `BrowserAgentRunOptions` carry per-run configuration; `V2AgentLoopOptions` remains construction-only; `PromptLayoutEngine.render(ir, opts)` receives the flags.
