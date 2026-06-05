import type {
  OperationalProjection,
  ProjectionItem,
  ProjectionRegion,
  SerializedProjection,
} from '../brain1/projectionTypes';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import type { TransitionEvidence, V2ToolResult } from '../runtime/types';
import type {
  PlannerQuarantinedAction,
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
  maxChangedRefs: 16,
};

export interface PlannerWorkingSetSelectorInput {
  goal: string;
  projection: OperationalProjection;
  graphSnapshot?: ContinuityGraphSnapshot;
  transitionEvidence?: TransitionEvidence;
  lastResult?: V2ToolResult;
  failureEvidence?: FailureEvidence[];
  uncertaintySignals?: readonly string[];
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
    const evidence = buildEvidenceSets(input);
    const candidates = input.projection.interactions.map(item => scoreCandidate(item, input.goal, evidence));
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
    const quarantinedActions = buildQuarantinedActions(input);
    const actionSurface = buildActionSurface(input.projection, selectedSet, quarantinedActions);
    const navigationRefs = input.projection.navigation
      .filter(item => selectedSet.has(item.refId))
      .slice(0, this.options.maxNavigationRefs)
      .map(item => toWorkingSetRef(
        item,
        selected.find(candidate => candidate.item.refId === item.refId)?.reasons ?? new Set(['navigation_candidate']),
      ));
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
        primaryRefs: primary.map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
        secondaryRefs: secondary.map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
        readableEvidence,
        navigationRefs,
        actionSurface,
        changedRefs: buildChangedRefsSummary(selected, evidence, this.options.maxChangedRefs),
        failedRefs: selected
          .filter(candidate => candidate.reasons.has('last_failure'))
          .map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score)),
        quarantinedActions,
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

function buildEvidenceSets(input: PlannerWorkingSetSelectorInput): {
  appearedRefs: Set<string>;
  weakenedRefs: Set<string>;
  preservedRefs: Set<string>;
  changedRefs: Set<string>;
  failedRefs: Set<string>;
} {
  const graphTransitions = input.graphSnapshot?.transitions ?? [];
  const latestGraphTransition = graphTransitions[graphTransitions.length - 1];
  const latestGraphTransitionId = latestGraphTransition?.transitionId;
  const graphChangedRefs = latestGraphTransitionId
    ? new Set([
        ...(latestGraphTransition?.refChanges.appeared ?? []),
        ...(latestGraphTransition?.refChanges.weakened ?? []),
        ...(input.graphSnapshot?.refs ?? [])
          .filter(ref => ref.present && ref.lastChangedTransitionId === latestGraphTransitionId)
          .map(ref => ref.refId),
      ])
    : new Set<string>();
  const appearedRefs = new Set([
    ...(input.transitionEvidence?.refChanges.appeared ?? []),
    ...(latestGraphTransition?.refChanges.appeared ?? []),
  ]);
  const weakenedRefs = new Set([
    ...(input.transitionEvidence?.refChanges.weakened ?? []),
    ...(latestGraphTransition?.refChanges.weakened ?? []),
  ]);

  return {
    appearedRefs,
    weakenedRefs,
    preservedRefs: new Set([
      ...(input.transitionEvidence?.refChanges.preserved ?? []),
      ...(latestGraphTransition?.refChanges.preserved ?? []),
    ]),
    changedRefs: new Set([
      ...appearedRefs,
      ...weakenedRefs,
      ...graphChangedRefs,
    ]),
    failedRefs: new Set([
      ...(input.failureEvidence ?? []).map(failure => failure.targetRef).filter((refId): refId is string => Boolean(refId)),
      input.lastResult?.success === false ? input.lastResult.targetRef : undefined,
    ].filter((refId): refId is string => Boolean(refId))),
  };
}

function scoreCandidate(
  item: ProjectionItem,
  goal: string,
  evidence: { appearedRefs: Set<string>; changedRefs: Set<string>; failedRefs: Set<string> },
): Candidate {
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
  }
  const lowValueReason = classifyLowValue(item);
  const dropReason = evidence.failedRefs.has(item.refId) || evidence.changedRefs.has(item.refId)
    ? undefined
    : lowValueReason;
  return { item, score, reasons, dropReason };
}

function shouldKeepCandidate(candidate: Candidate): boolean {
  return candidate.dropReason === undefined && candidate.reasons.size > 0;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.item.refId.localeCompare(right.item.refId);
}

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

function buildQuarantinedActions(input: PlannerWorkingSetSelectorInput): PlannerQuarantinedAction[] {
  const actions: PlannerQuarantinedAction[] = [];
  const lastTool = input.lastResult?.kind;
  const lastRef = input.lastResult?.targetRef;

  for (const failure of input.failureEvidence ?? []) {
    if (!failure.targetRef) continue;
    if (failure.retryable !== false || failure.persistence !== 'persistent') continue;
    if (failure.targetRef !== lastRef) continue;
    actions.push({
      refId: failure.targetRef,
      tool: lastTool ?? 'unknown',
      failureKind: failure.kind,
      retryable: failure.retryable,
      persistence: failure.persistence,
    });
  }

  actions.push(...quarantinedActionsFromUncertainty(input.uncertaintySignals));

  return uniqueQuarantinedActions(actions);
}

function quarantinedActionsFromUncertainty(signals: readonly string[] | undefined): PlannerQuarantinedAction[] {
  const actions: PlannerQuarantinedAction[] = [];
  for (const signal of signals ?? []) {
    const match = signal.match(/^repeated_no_progress_transition:([^:]+):([^:]+):(\d+)$/);
    if (!match) continue;
    const [, tool, refId, countText] = match;
    const count = Number.parseInt(countText, 10);
    if (!Number.isFinite(count) || count < 3) continue;
    actions.push({
      refId,
      tool,
      failureKind: 'no_progress_loop',
      retryable: false,
      persistence: 'persistent',
    });
  }
  return actions;
}

function uniqueQuarantinedActions(actions: PlannerQuarantinedAction[]): PlannerQuarantinedAction[] {
  const seen = new Set<string>();
  const unique: PlannerQuarantinedAction[] = [];
  for (const action of actions) {
    const key = `${action.tool}:${action.refId}:${action.failureKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }
  return unique;
}

function isQuarantinedForTool(refId: string, tool: 'click' | 'type' | 'select', quarantinedActions: PlannerQuarantinedAction[]): boolean {
  return quarantinedActions.some(action =>
    action.refId === refId
    && (action.tool === tool || (action.tool === 'close' && tool === 'click'))
    && action.retryable === false
    && action.persistence === 'persistent'
  );
}

function buildActionSurface(
  projection: OperationalProjection,
  selectedSet: Set<string>,
  quarantinedActions: PlannerQuarantinedAction[],
): {
  clickableRefs: string[];
  typeableRefs: string[];
  selectableRefs: string[];
  readableRefs: string[];
  ambiguousRefs: string[];
} {
  const selectedItems = projection.interactions.filter(item => selectedSet.has(item.refId));
  const readableSet = new Set(
    projection.readables
      .filter(item => selectedSet.has(item.refId))
      .filter(item => Boolean(item.name?.trim() || item.text?.trim()))
      .map(item => item.refId),
  );
  const clickableRefs: string[] = [];
  const typeableRefs: string[] = [];
  const selectableRefs: string[] = [];
  const ambiguousRefs: string[] = [];

  for (const item of selectedItems) {
    if (!isExecutableCandidate(item)) {
      continue;
    }
    if (isClickableCandidate(item) && !isQuarantinedForTool(item.refId, 'click', quarantinedActions)) {
      clickableRefs.push(item.refId);
    }
    if (isTypeableCandidate(item) && !isQuarantinedForTool(item.refId, 'type', quarantinedActions)) {
      typeableRefs.push(item.refId);
    }
    if (isSelectableCandidate(item) && !isQuarantinedForTool(item.refId, 'select', quarantinedActions)) {
      selectableRefs.push(item.refId);
    }
    if (
      hasInteractiveSignal(item)
      && !isClickableCandidate(item)
      && !isTypeableCandidate(item)
      && !isSelectableCandidate(item)
    ) {
      ambiguousRefs.push(item.refId);
    }
  }

  return {
    clickableRefs: uniqueRefs(clickableRefs),
    typeableRefs: uniqueRefs(typeableRefs),
    selectableRefs: uniqueRefs(selectableRefs),
    readableRefs: uniqueRefs([...readableSet]),
    ambiguousRefs: uniqueRefs(ambiguousRefs),
  };
}

function buildChangedRefsSummary(
  selected: Candidate[],
  evidence: {
    appearedRefs: Set<string>;
    weakenedRefs: Set<string>;
    preservedRefs: Set<string>;
    failedRefs: Set<string>;
  },
  maxChangedRefs: number,
): {
  appearedCount: number;
  weakenedCount: number;
  preservedCount: number;
  topRefs: PlannerWorkingSetRef[];
  omittedCount: number;
} {
  const changedCandidates = selected
    .filter(candidate =>
      evidence.failedRefs.has(candidate.item.refId)
      || evidence.appearedRefs.has(candidate.item.refId)
      || evidence.weakenedRefs.has(candidate.item.refId),
    )
    .sort((left, right) => compareChangedRefPriority(left, right, evidence));
  const topRefs = changedCandidates
    .slice(0, maxChangedRefs)
    .map(candidate => toWorkingSetRef(candidate.item, candidate.reasons, candidate.score));

  return {
    appearedCount: evidence.appearedRefs.size,
    weakenedCount: evidence.weakenedRefs.size,
    preservedCount: evidence.preservedRefs.size,
    topRefs,
    omittedCount: Math.max(0, changedCandidates.length - topRefs.length),
  };
}

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

function compareChangedRefPriority(
  left: Candidate,
  right: Candidate,
  evidence: {
    appearedRefs: Set<string>;
    weakenedRefs: Set<string>;
    failedRefs: Set<string>;
  },
): number {
  const leftPriority = changedRefPriority(left, evidence);
  const rightPriority = changedRefPriority(right, evidence);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return compareCandidates(left, right);
}

function changedRefPriority(
  candidate: Candidate,
  evidence: {
    appearedRefs: Set<string>;
    weakenedRefs: Set<string>;
    failedRefs: Set<string>;
  },
): number {
  const refId = candidate.item.refId;
  if (evidence.failedRefs.has(refId)) return 1;
  if (candidate.reasons.has('goal_keyword_match') && evidence.appearedRefs.has(refId)) return 3;
  if (candidate.reasons.has('goal_keyword_match') && evidence.weakenedRefs.has(refId)) return 4;
  if (evidence.appearedRefs.has(refId)) return 5;
  if (evidence.weakenedRefs.has(refId)) return 6;
  return 99;
}

function hasInteractiveSignal(item: ProjectionItem): boolean {
  const role = item.role?.toLowerCase();
  return Boolean(
    item.capabilities?.clickable
    || item.capabilities?.typeable
    || item.capabilities?.selectable
    || role === 'button'
    || role === 'link'
    || role === 'textbox'
    || role === 'searchbox'
    || role === 'combobox'
    || role === 'menuitem'
    || role === 'option'
    || item.kind === 'button'
    || item.kind === 'link'
    || item.kind === 'input'
    || item.kind === 'select'
    || item.kind === 'editable'
  );
}

function isExecutableCandidate(item: ProjectionItem): boolean {
  return item.state !== 'stale'
    && item.state !== 'invalid'
    && item.visibility !== 'hidden'
    && item.actionability === 'ready';
}

function isClickableCandidate(item: ProjectionItem): boolean {
  if (item.capabilities) {
    return item.capabilities.clickable;
  }

  const role = item.role?.toLowerCase();
  return item.kind === 'button'
    || item.kind === 'link'
    || item.kind === 'input'
    || item.kind === 'select'
    || item.kind === 'editable'
    || role === 'button'
    || role === 'link'
    || role === 'menuitem'
    || role === 'option'
    || role === 'checkbox'
    || role === 'radio'
    || role === 'tab';
}

function isTypeableCandidate(item: ProjectionItem): boolean {
  if (item.capabilities) {
    return item.capabilities.typeable;
  }

  const role = item.role?.toLowerCase();
  return item.kind === 'input'
    || item.kind === 'editable'
    || role === 'textbox'
    || role === 'searchbox';
}

function isSelectableCandidate(item: ProjectionItem): boolean {
  if (item.capabilities) {
    return item.capabilities.selectable;
  }

  const role = item.role?.toLowerCase();
  return item.kind === 'select'
    || role === 'combobox'
    || role === 'listbox';
}

function uniqueRefs(refs: string[]): string[] {
  return [...new Set(refs)];
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
