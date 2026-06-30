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
  // PLANNER SURFACE always emits — the page surface is always present in planner context
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
    // Suppress role when it duplicates kind (e.g. role=button kind=button)
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    `lane="${element.lane}"`,
    `tier="${element.scoreTier}"`,
    element.regionId ? `region="${escapeAttr(element.regionId)}"` : undefined,
    element.text ? `text="${escapeAttr(element.text)}"` : undefined,
    element.selectOptions?.length ? `options="${escapeAttr(element.selectOptions.join(' | '))}"` : undefined,
    element.anomalies.length ? `state="${escapeAttr(element.anomalies.join(','))}"` : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
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
