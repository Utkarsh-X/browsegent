import type { PlannerElementIR, PlannerRepresentationIR } from './types';

export class PromptLayoutEngine {
  render(
    ir: PlannerRepresentationIR,
    options: { prcTierOmitted?: boolean; compactDataPlane?: boolean } = {},
  ): string {
    if (options.compactDataPlane) {
      return renderCompactDataPlane(ir, options);
    }

    return [
      renderMission(ir),
      renderState(ir),
      renderRecentEvents(ir),
      renderEvidenceCoverage(ir),
      renderEvidenceSnapshot(ir),
      renderProblems(ir),
      renderSurface(ir, options),
      renderWorkingSet(ir),
      renderDecisionSignals(ir),
    ].filter(Boolean).join('\n\n');
  }
}

function renderMission(ir: PlannerRepresentationIR): string {
  return `MISSION\n  goal: ${ir.execution.goal}`;
}

function renderCompactDataPlane(
  ir: PlannerRepresentationIR,
  options: { prcTierOmitted?: boolean },
): string {
  return [
    renderCompactState(ir),
    renderCompactLast(ir),
    renderCompactEvidence(ir),
    renderCompactProblems(ir),
    renderCompactSurface(ir, options),
    renderCompactWorkingSet(ir),
  ].filter(Boolean).join('\n');
}

function renderCompactState(ir: PlannerRepresentationIR): string {
  const page = ir.execution.page
    ? ` page="${escapeAttr(compactValue(ir.execution.page.title, 160))}" url="${escapeAttr(compactValue(ir.execution.page.url, 512))}"`
    : '';
  const continuity = ir.execution.continuity
    ? ` obs=${ir.execution.continuity.observationId ?? 'unknown'} gen=${ir.execution.continuity.generationId ?? 'unknown'} refs=${ir.execution.continuity.presentRefCount}`
    : '';
  const focus = ir.execution.focus ? ` focus=${ir.execution.focus.refId}` : '';
  return `S: goal="${escapeAttr(compactValue(ir.execution.goal, 320))}"${page}${continuity}${focus}`;
}

function renderCompactLast(ir: PlannerRepresentationIR): string {
  const parts: string[] = [];
  const last = ir.execution.lastResult;
  if (last) {
    parts.push(`result=${last.kind}:${last.success ? 'ok' : `failed:${last.error?.code ?? 'unknown'}`}`);
    if (last.targetRef) parts.push(`target=${last.targetRef}`);
    if (last.valuePreview) parts.push(`value="${escapeAttr(compactValue(last.valuePreview))}"`);
  }
  const transition = ir.execution.transition;
  if (transition) {
    const counts = transition.refChangeCounts;
    parts.push(`transition=${transition.transitionClass}:${transition.strength}`);
    parts.push(`changes=${counts.appeared}/${counts.disappeared}/${counts.weakened}/${counts.preserved}`);
  }
  const lineage = ir.execution.lineage;
  if (lineage) {
    parts.push(`lineage=total=${lineage.totalSteps}${lineage.truncated ? ':truncated' : ''}`);
    if (lineage.steps.length > 0) {
      parts.push(`steps=${lineage.steps.map(step => [
        step.stepId,
        step.index,
        step.kind,
        step.status,
        step.targetRef,
        step.errorCode,
      ].filter(value => value !== undefined).join(':')).join(',')}`);
    }
  }
  return parts.length > 0 ? `LAST: ${parts.join(' ')}` : '';
}

function renderCompactEvidence(ir: PlannerRepresentationIR): string {
  const coverage = ir.execution.evidenceCoverage;
  const parts: string[] = [];
  if (coverage) {
    const requirements = coverage.requirements.map(requirement =>
      `${requirement.key}:${requirement.status}@${requirement.supportingReadIndexes.join(',') || '-'}`,
    );
    parts.push(`contract=${escapeAttr(coverage.contractKind)} state=${coverage.status} reads=${coverage.readCount}`);
    if (requirements.length) parts.push(`requirements=${requirements.join(';')}`);
  }
  const snapshot = ir.execution.evidenceSnapshot;
  if (snapshot) {
    parts.push(`facts=${renderCompactEvidenceFacts(snapshot)}`);
  }
  return parts.length > 0 ? `EVIDENCE: ${parts.join(' ')}` : '';
}

function renderEvidenceSnapshot(ir: PlannerRepresentationIR): string {
  const snapshot = ir.execution.evidenceSnapshot;
  if (!snapshot || snapshot.cards.length === 0) return '';

  const lines = ['EVIDENCE SNAPSHOT'];
  if (snapshot.activeSort) {
    lines.push(`  sort: ${snapshot.activeSort.dimension} (${snapshot.activeSort.direction}) via ${snapshot.activeSort.source}`);
  }
  for (const card of snapshot.cards) {
    const parts: string[] = [];
    if (card.provenRank !== undefined) parts.push(`Rank #${card.provenRank}`);
    else parts.push(`Position ${card.position + 1}`);
    if (card.entity) parts.push(card.entity);
    if (card.metrics.stars !== undefined) parts.push(`${card.metrics.stars} stars`);
    if (card.metrics.rating !== undefined) parts.push(`Rating: ${card.metrics.rating}`);
    if (card.metrics.reviewCount !== undefined) parts.push(`${card.metrics.reviewCount} reviews`);
    if (card.metrics.price !== undefined) parts.push(`Price: ${card.metrics.price}`);
    if (card.metrics.citations !== undefined) parts.push(`${card.metrics.citations} citations`);
    if (card.temporal?.length) parts.push(card.temporal.join(', '));
    if (card.refIds.length) parts.push(`refs=${card.refIds.join(',')}`);
    lines.push(`  ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

function renderCompactEvidenceFacts(snapshot: NonNullable<PlannerRepresentationIR['execution']['evidenceSnapshot']>): string {
  const sort = snapshot.activeSort
    ? `sort=${snapshot.activeSort.dimension}:${snapshot.activeSort.direction}:${snapshot.activeSort.source}`
    : '';
  const cards = snapshot.cards.map(card => {
    const fields = [
      card.provenRank !== undefined ? `rank${card.provenRank}` : `pos${card.position + 1}`,
      card.entity ? escapeAttr(compactValue(card.entity, 160)) : undefined,
      card.metrics.stars !== undefined ? `stars=${card.metrics.stars}` : undefined,
      card.metrics.rating !== undefined ? `rating=${card.metrics.rating}` : undefined,
      card.metrics.reviewCount !== undefined ? `reviews=${card.metrics.reviewCount}` : undefined,
      card.metrics.price !== undefined ? `price=${card.metrics.price}` : undefined,
      card.metrics.citations !== undefined ? `citations=${card.metrics.citations}` : undefined,
      card.refIds.length ? `refs=${card.refIds.join(',')}` : undefined,
    ].filter(Boolean);
    return fields.join(':');
  }).join(';');
  return [sort, cards].filter(Boolean).join(' cards=');
}

function renderCompactProblems(ir: PlannerRepresentationIR): string {
  const parts: string[] = [];
  for (const failure of ir.execution.failures) {
    parts.push(`failure=${failure.targetRef ?? 'none'}:${failure.kind}:${failure.persistence}:${failure.retryable ? 'retryable' : 'final'}`);
  }
  if (ir.execution.deadState) {
    parts.push(`dead=${ir.execution.deadState.severity}:${compactList(ir.execution.deadState.reasons)}:${compactList(ir.execution.deadState.failureKinds)}`);
  }
  if (ir.execution.recovery) {
    const recovery = ir.execution.recovery;
    const blocked = recovery.blockedAction
      ? ` blocked=${recovery.blockedAction.tool}:${recovery.blockedAction.ref ?? 'global'}`
      : '';
    parts.push(`recovery=${recovery.state}${blocked} next=${compactList(recovery.nextMechanisms)} signals=${compactList(recovery.signals)}`);
  }
  if (ir.execution.answerFeedback) {
    const feedback = ir.execution.answerFeedback;
    parts.push(`answerFeedback=missing:${compactList(feedback.missingDetails)} instruction="${escapeAttr(compactValue(feedback.instruction))}" previous="${escapeAttr(compactValue(feedback.previousAnswer))}"`);
  }
  if (ir.execution.uncertainty.level !== 'none') {
    parts.push(`uncertainty=${ir.execution.uncertainty.level}:${compactList(ir.execution.uncertainty.signals)}`);
  }
  return parts.length > 0 ? `PROBLEMS: ${parts.join(' ')}` : '';
}

function renderCompactSurface(
  ir: PlannerRepresentationIR,
  options: { prcTierOmitted?: boolean },
): string {
  const lines = ['SURFACE:'];
  for (const group of ir.surface.groups) {
    lines.push(`  region=${escapeAttr(group.regionId)} name="${escapeAttr(compactValue(group.label, 120))}"${group.omittedCount ? ` omitted=${group.omittedCount}/${group.totalCount}` : ''}`);
    for (const element of group.elements) lines.push(`    ${renderCompactElement(element, options)}`);
  }
  if (ir.surface.remainder.length > 0) {
    lines.push('  region=remainder');
    for (const element of ir.surface.remainder) lines.push(`    ${renderCompactElement(element, options)}`);
  }
  return lines.join('\n');
}

function renderCompactElement(
  element: PlannerElementIR,
  options: { prcTierOmitted?: boolean },
): string {
  const attrs = [
    `n="${escapeAttr(compactValue(element.name, 220))}"`,
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    element.ariaAutocomplete ? `ac=${escapeAttr(compactValue(element.ariaAutocomplete, 40))}` : undefined,
    element.ariaHasPopup ? `popup=${escapeAttr(compactValue(element.ariaHasPopup, 40))}` : undefined,
    element.value !== undefined ? `value="${escapeAttr(compactValue(element.value, 160))}"` : undefined,
    element.placeholder ? `ph="${escapeAttr(compactValue(element.placeholder, 160))}"` : undefined,
    `l=${element.lane}`,
    options.prcTierOmitted ? undefined : `tier=${element.scoreTier}`,
    element.regionId ? `region=${escapeAttr(compactValue(element.regionId, 120))}` : undefined,
    element.text ? `text="${escapeAttr(compactValue(element.text, 220))}"` : undefined,
    element.selectOptions?.length ? `options="${escapeAttr(element.selectOptions.map(option => compactValue(option, 120)).join('|'))}"` : undefined,
    element.anomalies.length ? `state="${escapeAttr(compactList(element.anomalies))}"` : undefined,
    element.failure ? `failed=${escapeAttr(compactValue(element.failure.kind, 120))}x${element.failure.count}` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
    options.prcTierOmitted ? `s=${element.score}` : undefined,
  ].filter(Boolean);
  return `[${element.refId}] <${element.kind} ${attrs.join(' ')} />`;
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
  if (ir.execution.recovery) {
    const r = ir.execution.recovery;
    const blockedStr = r.blockedAction
      ? ` blocked=${r.blockedAction.tool}:${r.blockedAction.ref ?? 'global'}`
      : '';
    lines.push(`  recovery: ${r.state}${blockedStr}`);
    if (r.nextMechanisms.length > 0) {
      lines.push(`    BLOCKED: Do NOT repeat the blocked action. Try: ${r.nextMechanisms.join(', ')}.`);
    }
  }
  if (ir.execution.answerFeedback) lines.push(`  answer_feedback: missing ${ir.execution.answerFeedback.missingDetails.join(', ')}`);
  if (ir.execution.uncertainty.level !== 'none') lines.push(`  uncertainty: ${ir.execution.uncertainty.level} ${ir.execution.uncertainty.signals.join(', ')}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderEvidenceCoverage(ir: PlannerRepresentationIR): string {
  const coverage = ir.execution.evidenceCoverage;
  if (!coverage || coverage.requirements.length === 0) return '';
  const lines = [`EVIDENCE COVERAGE\n  state: ${coverage.status} reads=${coverage.readCount}`];
  for (const requirement of coverage.requirements) {
    const reads = requirement.supportingReadIndexes.length > 0
      ? ` reads=${requirement.supportingReadIndexes.join(',')}`
      : '';
    lines.push(`  ${requirement.key}: ${requirement.status}${reads}`);
  }
  return lines.join('\n');
}

function renderSurface(ir: PlannerRepresentationIR, options: { prcTierOmitted?: boolean }): string {
  // PLANNER SURFACE always emits — the page surface is always present in planner context
  const lines = ['PLANNER SURFACE'];
  for (const group of ir.surface.groups) {
    lines.push(`  ${group.label} (${group.regionId}${group.omittedCount ? `, omitted ${group.omittedCount} of ${group.totalCount}` : ''})`);
    for (const element of group.elements) lines.push(`    ${renderElement(element, options)}`);
  }
  if (ir.surface.remainder.length > 0) {
    lines.push('  Page Elements');
    for (const element of ir.surface.remainder) lines.push(`    ${renderElement(element, options)}`);
  }
  return lines.join('\n');
}

function renderElement(element: PlannerElementIR, options: { prcTierOmitted?: boolean } = {}): string {
  const attrs = [
    `name="${escapeAttr(element.name)}"`,
    // Suppress role when it duplicates kind (e.g. role=button kind=button)
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    element.ariaAutocomplete ? `aria-autocomplete="${escapeAttr(element.ariaAutocomplete)}"` : undefined,
    element.ariaHasPopup ? `aria-haspopup="${escapeAttr(element.ariaHasPopup)}"` : undefined,
    element.value !== undefined ? `value="${escapeAttr(element.value)}"` : undefined,
    element.placeholder ? `placeholder="${escapeAttr(element.placeholder)}"` : undefined,
    `lane="${element.lane}"`,
    options.prcTierOmitted ? undefined : `tier="${element.scoreTier}"`,
    element.regionId ? `region="${escapeAttr(element.regionId)}"` : undefined,
    element.text ? `text="${escapeAttr(element.text)}"` : undefined,
    element.selectOptions?.length ? `options="${escapeAttr(element.selectOptions.join(' | '))}"` : undefined,
    element.anomalies.length ? `state="${escapeAttr(element.anomalies.join(','))}"` : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
    options.prcTierOmitted ? `s="${element.score}"` : undefined,
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
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderCompactWorkingSet(ir: PlannerRepresentationIR): string {
  const ws = ir.workingSet;
  if (!ws) return '';
  const parts: string[] = [];
  if (ws.mode) parts.push(`mode=${ws.mode}${ws.modeReason ? `:${escapeAttr(compactValue(ws.modeReason, 120))}` : ''}`);
  if (ws.primary.length) parts.push(`primary=${renderCompactRefs(ws.primary)}`);
  if (ws.secondary.length) parts.push(`secondary=${renderCompactRefs(ws.secondary)}`);
  if (ws.navigation.length) parts.push(`navigation=${renderCompactRefs(ws.navigation)}`);
  if (ws.failed.length) parts.push(`failed=${renderCompactRefs(ws.failed)}`);
  if (ws.actionSurface) {
    const surface = ws.actionSurface;
    const renderedRefIds = new Set([
      ...ir.surface.groups.flatMap(group => group.elements.map(element => element.refId)),
      ...ir.surface.remainder.map(element => element.refId),
    ]);
    const actionLaneEntries: Array<{ lane: string; refs: readonly string[] }> = [
      { lane: 'c', refs: surface.clickableRefs },
      { lane: 't', refs: surface.typeableRefs },
      { lane: 's', refs: surface.selectableRefs },
      { lane: 'r', refs: surface.readableRefs },
      { lane: 'a', refs: surface.ambiguousRefs },
    ];
    const actionLanes = actionLaneEntries
      .map(({ lane, refs }) => `${lane}:${refs.filter(ref => !renderedRefIds.has(ref)).join(',')}`)
      .filter(part => !part.endsWith(':'));
    if (actionLanes.length > 0) parts.push(`actions=${actionLanes.join(' ')}`);
  }
  if (ws.readableEvidence.length) {
    parts.push(`readable=${ws.readableEvidence.map(evidence => `${evidence.refId}:${escapeAttr(compactValue(evidence.text, 160))}:${evidence.reasons.join('|')}`).join(';')}`);
  }
  const changed = ws.changedRefs;
  parts.push(`changed=${changed.appearedCount}/${changed.weakenedCount}/${changed.preservedCount}/${changed.omittedCount}`);
  if (changed.topRefs.length) parts.push(`changedTop=${renderCompactRefs(changed.topRefs)}`);
  if (ws.quarantinedActions.length) {
    parts.push(`quarantine=${ws.quarantinedActions.map(action => `${action.tool}:${action.refId}:${action.failureKind}:${action.retryable ? 'retryable' : 'persistent'}`).join(';')}`);
  }
  if (ws.regionSummaries.length) {
    parts.push(`regions=${ws.regionSummaries.map(region => `${region.regionId}:"${escapeAttr(compactValue(region.label, 120))}":${region.representativeRefs.join(',')}:${region.omittedRefCount}`).join(';')}`);
  }
  if (ws.omitted) parts.push(`omitted=${ws.omitted.observed}/${ws.omitted.selected}/${ws.omitted.dropped}`);
  return `W: ${parts.join(' ')}`;
}

function renderCompactRefs(refs: Array<{ refId: string; reasons: string[] }>): string {
  return refs.map(ref => `${ref.refId}(${ref.reasons.join('|')})`).join(',');
}

function compactList(values: readonly string[], maxItemLength = 120): string {
  return values.map(value => escapeAttr(compactValue(value, maxItemLength))).join('|');
}

function renderDecisionSignals(ir: PlannerRepresentationIR): string {
  const signals = ir.decisionSignals;
  if (!signals) return '';
  const lines = ['DECISION SIGNALS'];
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

function compactValue(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
