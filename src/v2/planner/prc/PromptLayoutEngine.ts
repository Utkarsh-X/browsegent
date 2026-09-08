import type { PlannerInput } from '../types';
import type { PlannerElementIR, PlannerRepresentationIR } from './types';
import { PlannerRepresentationCompiler } from './PlannerRepresentationCompiler';

export class PromptLayoutEngine {
  render(
    ir: PlannerRepresentationIR,
    options: { prcTierOmitted?: boolean; compactDataPlane?: boolean; leanPlane?: boolean; pageModel?: boolean; deltaSurface?: boolean; previousSurfaceLines?: readonly string[] } = {},
  ): string {
    if (options.compactDataPlane) {
      return renderCompactDataPlane(ir, options);
    }

    // Page-model stage 2a (L1): the volatile situation lines (observation, focus)
    // move after PLANNER SURFACE so same-page consecutive payloads share a longer
    // byte prefix, and continuity markers leave element lines (see
    // renderSurface's CONTINUITY header). Lean-plane only; off-path byte-identical.
    if (options.leanPlane === true && options.pageModel === true) {
      const wireMode = options.deltaSurface === true;
      return [
        renderMission(ir),
        renderStateHead(ir, wireMode),
        renderSurface(ir, options),
        renderStateTail(ir),
        renderRecentEvents(ir),
        renderEvidenceCoverage(ir),
        renderGoalProgress(ir),
        renderHorizon(ir),
        renderTaskProgress(ir),
        renderEvidenceSnapshot(ir),
        renderProblems(ir),
        renderWorkingSet(ir, true),
        renderDecisionSignals(ir),
      ].filter(Boolean).join('\n\n');
    }

    return [
      renderMission(ir),
      renderState(ir),
      renderRecentEvents(ir),
      renderEvidenceCoverage(ir),
      renderGoalProgress(ir),
      renderHorizon(ir),
      renderTaskProgress(ir),
      renderEvidenceSnapshot(ir),
      renderProblems(ir),
      renderSurface(ir, options),
      renderWorkingSet(ir, options.leanPlane === true),
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
    renderCompactGoalProgress(ir),
    renderCompactHorizon(ir),
    renderCompactTaskProgress(ir),
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
    if (last.success && last.effect === 'none') parts.push('effect=none');
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

function renderCompactGoalProgress(ir: PlannerRepresentationIR): string {
  const progress = ir.execution.goalProgress;
  if (!progress || progress.entries.length === 0) return '';

  const parts = progress.entries.map(e => `${e.key}=${e.state}`);
  if (progress.focus) {
    parts.push(`focus=${progress.focus}`);
  }
  return `GP: ${parts.join(' ')}`;
}

function renderCompactHorizon(ir: PlannerRepresentationIR): string {
  const horizon = ir.execution.horizon;
  if (!horizon) return '';

  const ordered = [...horizon.navControls].sort((left, right) =>
    Number(right.recommended ?? false) - Number(left.recommended ?? false),
  );
  const nav = ordered.map(control => {
    const name = control.name ? `"${escapeAttr(compactValue(control.name, 60))}"` : '';
    const flag = control.recommended ? '*' : '';
    return `${control.refId}${name}:${control.directionHint}${flag}${control.actionability !== 'ready' ? `:${control.actionability}` : ''}`;
  }).join(' ');
  const recommended = ordered.find(control => control.recommended && control.actionability === 'ready');
  const suggested = recommended ? ` suggested={"tool":"seek","ref":"${recommended.refId}"}` : '';
  return `HORIZON: visible=[${horizon.visibleMonths.join(',')}] need=[${horizon.targetMonths.join(',')}] nav=${nav}${suggested}`;
}

function renderCompactTaskProgress(ir: PlannerRepresentationIR): string {
  const progress = ir.execution.taskProgress;
  if (!progress || progress.items.length === 0) return '';

  const items = progress.items.map(item => {
    const evidence = item.evidence?.length ? `@${item.evidence.join(',')}` : '';
    return `${item.key}:${item.status}="${escapeAttr(compactValue(item.requested, 120))}"${evidence}`;
  }).join(';');
  return `PROGRESS: state=${progress.status} items=${items}`;
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

/** Page-model L1: the page identity is the stable head of the payload.
 *  Wire mode keeps the 8-byte STATE-blank-line convention the fixture pack
 *  pins (STATE, blank, page line — the reference renderer's split shape). */
function renderStateHead(ir: PlannerRepresentationIR, wireMode = false): string {
  const lines = ['STATE'];
  if (wireMode) lines.push('');
  if (ir.execution.page) lines.push(`  page: "${ir.execution.page.title}" ${ir.execution.page.url}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

/** Page-model L1: the volatile situation lines sit after the surface. */
function renderStateTail(ir: PlannerRepresentationIR): string {
  const lines = ['STATE'];
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
    const result = last.success
      ? (last.effect === 'none' ? 'ok (no observable effect)' : 'ok')
      : `failed ${last.error?.code ?? 'unknown'}`;
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

function renderGoalProgress(ir: PlannerRepresentationIR): string {
  const progress = ir.execution.goalProgress;
  if (!progress || progress.entries.length === 0) return '';

  const lines = ['GOAL PROGRESS'];
  for (const entry of progress.entries) {
    lines.push(`  ${entry.key}: ${entry.state}`);
  }
  if (progress.focus) {
    lines.push(`  focus: ${progress.focus}`);
  }
  return lines.join('\n');
}

function renderHorizon(ir: PlannerRepresentationIR): string {
  const horizon = ir.execution.horizon;
  if (!horizon) return '';

  const ordered = [...horizon.navControls].sort((left, right) =>
    Number(right.recommended ?? false) - Number(left.recommended ?? false),
  );
  const lines = ['HORIZON'];
  lines.push(`  visible months: ${horizon.visibleMonths.join(', ')}`);
  lines.push(`  goal needs: ${horizon.targetMonths.join(', ')} (outside the currently visible window)`);
  lines.push(`  advance with: ${ordered.map(control => {
    const name = control.name ? ` "${escapeAttr(compactValue(control.name, 60))}"` : '';
    const recommended = control.recommended ? ' [recommended]' : '';
    return `${control.refId}${name} (hint: ${control.directionHint}${recommended}, ${control.actionability})`;
  }).join(' | ')}`);
  const recommended = ordered.find(control => control.recommended && control.actionability === 'ready');
  if (recommended) {
    lines.push(`  suggested plan: {"tool":"seek","ref":"${recommended.refId}"}`);
  }
  return lines.join('\n');
}

function renderTaskProgress(ir: PlannerRepresentationIR): string {
  const progress = ir.execution.taskProgress;
  if (!progress || progress.items.length === 0) return '';

  const lines = [`TASK PROGRESS\n  state: ${progress.status}`];
  for (const item of progress.items) {
    const evidence = item.evidence?.length ? ` evidence=${item.evidence.join(',')}` : '';
    lines.push(`  ${item.key}: ${item.status} requested="${escapeAttr(compactValue(item.requested, 120))}"${evidence}`);
  }
  return lines.join('\n');
}

function renderSurface(ir: PlannerRepresentationIR, options: { prcTierOmitted?: boolean; compactDataPlane?: boolean; leanPlane?: boolean; pageModel?: boolean; deltaSurface?: boolean; previousSurfaceLines?: readonly string[] }): string {
  // PLANNER SURFACE always emits — the page surface is always present in planner context
  const lines = ['PLANNER SURFACE'];
  const lean = options.leanPlane === true;
  // Page-model C3: continuity markers leave element lines and render once, after
  // the stable block, as a single header — identity churn from bookkeeping ends.
  const normalizeMarkers = lean === true && options.pageModel === true;
  // Page-model 2b part 2 (W2 delta wire): refs whose content did not change since
  // the previous action render as a minimal kind+name line. The renderer cannot
  // see the previous render, so the working set's diff markers stand in for the
  // changed class (the selector derives them from the same transition evidence).
  // Carried refs render minimal too — their content is unchanged by definition.
  const wireMode = normalizeMarkers === true && options.deltaSurface === true;
  let weakenedCount = 0;
  let changedCount = 0;
  // W2 changed class: an element whose full marker-free lean line differs
  // from the same ref's line in the previous render (content changed or the
  // ref is new). The previous render's element lines arrive from the agent
  // loop, which owns the previous payload; the renderer stays stateless.
  const prevLines = options.previousSurfaceLines;
  const prevLineByRef = new Map<string, string>();
  if (wireMode && prevLines) {
    for (const line of prevLines) {
      const refId = /^\s*\[(v2ref[^\]]+)\]/.exec(line)?.[1];
      if (refId) prevLineByRef.set(refId, line.trim());
    }
  }
  let budget = lean ? LEAN_SURFACE_PAYLOAD_CAP : Number.POSITIVE_INFINITY;
  let omittedElements = 0;
  const pushLine = (line: string): void => {
    if (line.length > budget) {
      omittedElements += 1;
      return;
    }
    budget -= line.length;
    lines.push(line);
  };
  const pushElement = (element: PlannerElementIR): void => {
    if (normalizeMarkers) {
      if (element.anomalies.some(a => a.startsWith('state=')) || element.anomalies.some(a => a.startsWith('confidence='))) weakenedCount += 1;
      if (element.delta) changedCount += 1;
    }
    const line = `    ${lean ? renderLeanElement(element, normalizeMarkers) : renderElement(element, options)}`;
    pushLine(line);
  };
  if (wireMode) {
  // W2 wire: one flat list in refs-map (rank) order, split into the full
  // block (changed ∪ always-full) followed by the minimal block (stable
  // refs). Region headers and prose drop out — the wire's payload is the
  // ref set itself. Continuity counts cover the whole element set,
  // budget-independent: weakened = continuity-marker anomalies. The header's
  // changed count stays 0 on the wire: the delta markers ride on the full
  // lines themselves, so a summary count would duplicate them (the fixture
  // pack pins this convention byte-exactly).
    const fullBlock: string[] = [];
    const minimalBlock: string[] = [];
    for (const element of ir.surface.elementsInRefOrder) {
      if (element.anomalies.some(a => a.startsWith('state=')) || element.anomalies.some(a => a.startsWith('confidence='))) weakenedCount += 1;
      const classifierLine = renderLeanElement(element, true);
      const changed = !isMinimalWireElement(element, prevLineByRef.get(element.refId), classifierLine);
      if (changed) {
        // Wire full lines keep the +new/+chg delta markers (appearance/change
        // is exactly the information the wire must surface); continuity
        // markers stay normalized away.
        fullBlock.push(`    ${renderLeanElement(element, true, true)}`);
      } else {
        minimalBlock.push(`  ${renderMinimalWireElement(element)}`);
      }
    }
    for (const line of fullBlock) pushLine(line);
    for (const line of minimalBlock) pushLine(line);
  } else {
    for (const group of ir.surface.groups) {
      lines.push(`  ${group.label} (${group.regionId}${group.omittedCount ? `, omitted ${group.omittedCount} of ${group.totalCount}` : ''})`);
      for (const element of group.elements) pushElement(element);
    }
    if (ir.surface.remainder.length > 0) {
      lines.push('  Page Elements');
      for (const element of ir.surface.remainder) pushElement(element);
    }
    if (ir.surface.prose?.length) {
      lines.push('  Page Text (bounded)');
      for (const entry of ir.surface.prose) {
        const anchor = entry.anchorRefIds.length ? ` ("anchor: ${entry.anchorRefIds.join(',')}")` : '';
        pushLine(`    [${entry.proseId}]${anchor} ${escapeAttr(compactValue(entry.text, 300))}`);
      }
    }
  }
  if (omittedElements > 0) {
    lines.push(`  ... ${omittedElements} elements omitted (payload cap)`);
  }
  if (normalizeMarkers && (weakenedCount > 0 || changedCount > 0)) {
    lines.push(`  CONTINUITY: weakened=${weakenedCount} refs carried from before the last action; changed=${changedCount}`);
  }
  // The wire's payload is the ref set itself — the NEW SINCE summary is
  // redundant there (changed refs already render full).
  if (lean && !wireMode) {
    const topRefs = ir.workingSet?.changedRefs.topRefs ?? [];
    const named = topRefs
      .map(ref => `${ref.refId} "${escapeAttr(compactValue(ref.name ?? ref.text ?? '', 48))}"`)
      .slice(0, 8);
    if (named.length > 0) {
      lines.push(`  NEW SINCE LAST ACTION: ${named.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

/** Bounds worst-case lean payloads on very large DOMs (measured spikes to 20+ KB). */
const LEAN_SURFACE_PAYLOAD_CAP = 12_000;

/**
 * W2 delta wire: an element renders as a minimal kind+name line when its
 * full marker-free lean line is byte-identical to the same ref's line in
 * the previous render (content unchanged) and it is not always-full.
 * Always-full is the simulation's narrow class: inputs/selects (values
 * move), autocomplete/combobox roles (option sets move), and failed refs
 * (failure state is episode-specific) must never be id-referenced only.
 * Without a previous render (first episode) everything renders full — no
 * information is ever dropped on the first call.
 */
function isMinimalWireElement(
  element: PlannerElementIR,
  previousLine: string | undefined,
  currentLine: string,
): boolean {
  if (element.failure) return false;
  if (element.kind === 'input' || element.kind === 'select') return false;
  if (element.ariaAutocomplete || element.ariaHasPopup) return false;
  if (previousLine === undefined) return false;
  return previousLine === currentLine.trim();
}

/**
 * W2 minimal stable-ref line: id + kind + name (120-char cap), production
 * attr order, no value attr, no role attr — the stateless-completeness floor
 * from the world-model round-3 report. The compiler already falls back
 * name → text → refId, so the name attr is never silently empty.
 */
function renderMinimalWireElement(element: PlannerElementIR): string {
  return `[${element.refId}] <${element.kind} name="${escapeAttr(compactValue(element.name, 120))}" />`;
}

/**
 * Lean element rendering: name/value plus the attributes the planner guidance
 * actually references (tools, autocomplete signals, anomalies, failures).
 * Internal scoring metadata (lane/tier/score) and default states are omitted —
 * measured at ~1,100 tokens/call of substrate plumbing.
 */
function renderLeanElement(element: PlannerElementIR, normalizeMarkers = false, keepDelta = false): string {
  const attrs = [
    `name="${escapeAttr(compactValue(element.name, 120))}"`,
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    element.ariaAutocomplete ? `aria-autocomplete="${escapeAttr(element.ariaAutocomplete)}"` : undefined,
    element.ariaHasPopup ? `aria-haspopup="${escapeAttr(element.ariaHasPopup)}"` : undefined,
    element.value !== undefined ? `value="${escapeAttr(compactValue(element.value, 120))}"` : undefined,
    !element.name && element.placeholder ? `placeholder="${escapeAttr(compactValue(element.placeholder, 80))}"` : undefined,
    element.selectOptions?.length
      ? `options="${escapeAttr(compactValue(element.selectOptions.map(option => compactValue(option, MAX_OPTION_CHARS)).join(' | '), MAX_OPTIONS_TOTAL_CHARS))}"`
      : undefined,
    // Page-model C3: continuity markers (state=weakened / confidence=…) move to
    // the surface's CONTINUITY header; element facts (visibility, actionability) stay.
    // Page-model 2a conformance: when every anomaly is a continuity marker the
    // filtered array empties and the attr is omitted entirely — never a phantom
    // state="" (the round-2 textual strip left one; the fixtures pin omission).
    element.anomalies.length
      ? (() => {
          const anomalies = normalizeMarkers
            ? element.anomalies.filter(a => !a.startsWith('state=') && !a.startsWith('confidence='))
            : element.anomalies;
          return anomalies.length > 0 ? `state="${escapeAttr(anomalies.join(','))}"` : undefined;
        })()
      : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
    element.delta && (keepDelta || !normalizeMarkers) ? `+${element.delta}` : undefined,
  ].filter(Boolean);
  return `[${element.refId}] <${element.kind} ${attrs.join(' ')} />`;
}

// Planning-context caps for surface element attributes. Answer evidence flows
// through get()/EVIDENCE, not through these lines; options stay readable since
// select actions depend on exact visible labels.
const MAX_ELEMENT_ATTR_CHARS = 140;
const MAX_OPTION_CHARS = 48;
const MAX_OPTIONS_TOTAL_CHARS = 240;

function renderElement(element: PlannerElementIR, options: { prcTierOmitted?: boolean } = {}): string {
  const attrs = [
    `name="${escapeAttr(compactValue(element.name, MAX_ELEMENT_ATTR_CHARS))}"`,
    // Suppress role when it duplicates kind (e.g. role=button kind=button)
    element.role && element.role !== element.kind ? `role="${escapeAttr(element.role)}"` : undefined,
    element.ariaAutocomplete ? `aria-autocomplete="${escapeAttr(element.ariaAutocomplete)}"` : undefined,
    element.ariaHasPopup ? `aria-haspopup="${escapeAttr(element.ariaHasPopup)}"` : undefined,
    element.value !== undefined ? `value="${escapeAttr(compactValue(element.value, MAX_ELEMENT_ATTR_CHARS))}"` : undefined,
    element.placeholder ? `placeholder="${escapeAttr(compactValue(element.placeholder, MAX_ELEMENT_ATTR_CHARS))}"` : undefined,
    `lane="${element.lane}"`,
    options.prcTierOmitted ? undefined : `tier="${element.scoreTier}"`,
    element.regionId ? `region="${escapeAttr(element.regionId)}"` : undefined,
    element.text ? `text="${escapeAttr(compactValue(element.text, MAX_ELEMENT_ATTR_CHARS))}"` : undefined,
    element.selectOptions?.length
      ? `options="${escapeAttr(compactValue(element.selectOptions.map(option => compactValue(option, MAX_OPTION_CHARS)).join(' | '), MAX_OPTIONS_TOTAL_CHARS))}"`
      : undefined,
    element.anomalies.length ? `state="${escapeAttr(element.anomalies.join(','))}"` : undefined,
    element.failure ? `failed="${element.failure.kind}x${element.failure.count}"` : undefined,
    element.tools?.length ? `tools="${element.tools.join(',')}"` : undefined,
    options.prcTierOmitted ? `s="${element.score}"` : undefined,
  ].filter(Boolean);
  return `[${element.refId}] <${element.kind} ${attrs.join(' ')} />`;
}

/**
 * Page-model 2b (W2 wire): the previous payload's full marker-free surface
 * element lines — the line-diff source for the changed class. The loop owns
 * the previous render; the renderer stays stateless. The baseline is the
 * previous input's stage-2a full render (the same semantics the validated
 * simulation used): re-rendering it through the layout engine keeps the
 * line format, selection, and budget cap byte-faithful by construction.
 */
export function buildPreviousSurfaceLines(plannerInput: PlannerInput): string[] {
  const ir = new PlannerRepresentationCompiler().compile(plannerInput, { stableOrder: false });
  const rendered = new PromptLayoutEngine().render(ir, { leanPlane: true, pageModel: true });
  return rendered.split('\n').filter(line => /^    \[v2ref[^\]]+\]/.test(line));
}
/**
 * Short, still-readable codes for the fixed working-set reason vocabulary.
 * The long snake_case tokens repeat per ref in every working-set list and were
 * measured at ~35% of the whole rendered planner prompt; the codes are
 * mnemonics, and the system prompt documents the non-obvious ones.
 */
const REASON_CODES: Record<string, string> = {
  visible_ready: 'ready',
  goal_keyword_match: 'kw',
  goal_phrase_match: 'phrase',
  role_relevant_to_goal: 'role',
  near_focus: 'focus',
  recently_appeared: 'new',
  recently_changed: 'changed',
  last_target: 'target',
  last_success: 'ok',
  last_failure: 'failed',
  recovery_control: 'recovery',
  horizon_control: 'horizon',
  target_value: 'value',
  submit_control: 'submit',
  dead_state_evidence: 'dead',
  answer_candidate: 'answer',
  suggestion_option: 'suggestion',
  result_row: 'row',
  navigation_candidate: 'nav',
  form_candidate: 'form',
  region_representative: 'rep',
};

function renderReasons(reasons: readonly string[]): string {
  return reasons.map(reason => REASON_CODES[reason] ?? reason).join(',');
}

function renderWorkingSet(ir: PlannerRepresentationIR, leanPlane = false): string {
  const ws = ir.workingSet;
  if (!ws) return '';
  // Lean plane keeps only the mode line: the ref/reason narrative was measured
  // at ~2.6 KB/call and duplicates information the surface already carries.
  if (leanPlane) {
    return ws.mode ? `WORKING SET\n  mode: ${ws.mode}` : '';
  }
  const lines = ['WORKING SET'];
  if (ws.mode) lines.push(`  mode: ${ws.mode}${ws.modeReason ? ` ${escapeAttr(compactValue(ws.modeReason, 120))}` : ''}`);
  if (ws.primary.length) lines.push(`  primary: ${ws.primary.map(ref => `${ref.refId}(${renderReasons(ref.reasons)})`).join(', ')}`);
  if (ws.secondary.length) lines.push(`  secondary: ${ws.secondary.map(ref => `${ref.refId}(${renderReasons(ref.reasons)})`).join(', ')}`);
  if (ws.navigation.length) lines.push(`  navigation: ${ws.navigation.map(ref => `${ref.refId}(${renderReasons(ref.reasons)})`).join(', ')}`);
  if (ws.failed.length) lines.push(`  failed: ${ws.failed.map(ref => `${ref.refId}(${renderReasons(ref.reasons)})`).join(', ')}`);
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
    // The W: readable entry is an evidence pointer (ref + gist + reasons), not
    // the full read value — EVIDENCE:/get results carry the full text. The
    // previous 160-char excerpts made compact renders larger than the verbose
    // baseline they were meant to shrink.
    parts.push(`readable=${ws.readableEvidence.map(evidence => `${evidence.refId}:${escapeAttr(compactValue(evidence.text, 48))}:${evidence.reasons.join('|')}`).join(';')}`);
  }
  const changed = ws.changedRefs;
  parts.push(`changed=${changed.appearedCount}/${changed.weakenedCount}/${changed.preservedCount}/${changed.omittedCount}`);
  if (changed.topRefs.length) parts.push(`changedTop=${renderCompactRefs(changed.topRefs)}`);
  if (ws.quarantinedActions.length) {
    parts.push(`quarantine=${ws.quarantinedActions.map(action => `${action.tool}:${action.refId}:${action.failureKind}:${action.retryable ? 'retryable' : 'persistent'}`).join(';')}`);
  }
  if (ws.regionSummaries.length) {
    parts.push(`regions=${ws.regionSummaries.map(region => `${region.regionId}:"${escapeAttr(compactValue(region.label, 32))}":${region.representativeRefs.join(',')}:${region.omittedRefCount}`).join(';')}`);
  }
  if (ws.omitted) parts.push(`omitted=${ws.omitted.observed}/${ws.omitted.selected}/${ws.omitted.dropped}`);
  return `W: ${parts.join(' ')}`;
}

function renderCompactRefs(refs: Array<{ refId: string; reasons: string[] }>): string {
  return refs.map(ref => `${ref.refId}(${renderReasons(ref.reasons)})`).join(',');
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
