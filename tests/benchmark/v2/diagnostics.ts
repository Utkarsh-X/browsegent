import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import type {
  BenchmarkAdapterResult,
  BenchmarkActionDiagnostics,
  BenchmarkDiagnostics,
  BenchmarkPayloadDiagnostics,
  BenchmarkPayloadSizeSummary,
  BenchmarkProjectionOverlapDiagnostics,
  BenchmarkPlannerInputSectionDiagnostics,
  BenchmarkWorkingSetDiagnostics,
} from './types';
import type { TraceArtifact, TraceManifest, TraceStep } from '../../../src/v2/trace/types';

const TARGET_ERROR_CODES = new Set([
  'target_not_found',
  'target_hidden',
  'target_disabled',
  'target_blocked',
  'stale_ref',
]);

export async function collectBenchmarkDiagnostics(result: BenchmarkAdapterResult): Promise<BenchmarkDiagnostics> {
  if (result.tracePath) {
    return collectTraceDiagnostics(result.tracePath);
  }

  if (result.artifactPath) {
    return collectExternalArtifactDiagnostics(result.artifactPath);
  }

  return emptyDiagnostics();
}

async function collectTraceDiagnostics(tracePath: string): Promise<BenchmarkDiagnostics> {
  const diagnostics = emptyDiagnostics();

  try {
    const manifest = JSON.parse(await readFile(tracePath, 'utf8')) as TraceManifest;
    diagnostics.payloads.traceBytes = await fileSize(tracePath, diagnostics.warnings, 'trace');
    diagnostics.payloads.observations = await summarizeArtifacts(tracePath, manifest.artifacts.observations, diagnostics.warnings);
    diagnostics.payloads.plannerInputs = await summarizeArtifacts(
      tracePath,
      manifest.artifacts.planner.filter(artifact => artifact.kind === 'planner_input'),
      diagnostics.warnings,
    );
    diagnostics.payloads.plannerInputSections = await summarizePlannerInputSections(
      tracePath,
      manifest.artifacts.planner.filter(artifact => artifact.kind === 'planner_input'),
      diagnostics.warnings,
    );
    diagnostics.projectionOverlap = await summarizeProjectionOverlap(
      tracePath,
      manifest.artifacts.planner.filter(artifact => artifact.kind === 'planner_input'),
      diagnostics.warnings,
    );
    diagnostics.workingSet = await summarizeWorkingSetDiagnostics(
      tracePath,
      manifest.artifacts.planner.filter(artifact => artifact.kind === 'planner_input'),
      diagnostics.warnings,
    );
    diagnostics.payloads.plannerOutputs = await summarizeArtifacts(
      tracePath,
      manifest.artifacts.planner.filter(artifact => artifact.kind === 'planner_output'),
      diagnostics.warnings,
    );
    diagnostics.payloads.failures = await summarizeArtifacts(tracePath, manifest.artifacts.failures ?? [], diagnostics.warnings);
    diagnostics.actions = summarizeActions(manifest.steps);
  } catch (error) {
    diagnostics.warnings.push(`diagnostics_unavailable:${error instanceof Error ? error.message : String(error)}`);
  }

  return diagnostics;
}

async function collectExternalArtifactDiagnostics(artifactPath: string): Promise<BenchmarkDiagnostics> {
  const diagnostics = emptyDiagnostics();

  try {
    diagnostics.payloads.traceBytes = await directorySize(artifactPath);
  } catch (error) {
    diagnostics.warnings.push(`diagnostics_unavailable:${error instanceof Error ? error.message : String(error)}`);
  }

  return diagnostics;
}

function summarizeActions(steps: TraceStep[]): BenchmarkActionDiagnostics {
  let failedStepCount = 0;
  let repeatedActionCount = 0;
  let invalidActionCount = 0;
  let previousSignature: string | undefined;

  for (const step of steps) {
    if (step.status === 'failed') {
      failedStepCount += 1;
    }

    const signature = actionSignature(step);
    if (signature && signature === previousSignature) {
      repeatedActionCount += 1;
    }
    previousSignature = signature;

    const errorCode = extractStepErrorCode(step);
    if (errorCode && TARGET_ERROR_CODES.has(errorCode)) {
      invalidActionCount += 1;
    }
  }

  return {
    stepCount: steps.length,
    failedStepCount,
    repeatedActionCount,
    invalidActionCount,
  };
}

async function summarizeArtifacts(
  tracePath: string,
  artifacts: TraceArtifact[],
  warnings: string[],
): Promise<BenchmarkPayloadSizeSummary> {
  const summary = emptyPayloadSummary();

  for (const artifact of artifacts) {
    const bytes = await fileSize(resolveArtifactPath(tracePath, artifact.path), warnings, artifact.id);
    summary.count += 1;
    summary.totalBytes += bytes;
    summary.maxBytes = Math.max(summary.maxBytes, bytes);
  }

  return summary;
}

async function summarizeProjectionOverlap(
  tracePath: string,
  artifacts: TraceArtifact[],
  warnings: string[],
): Promise<BenchmarkProjectionOverlapDiagnostics> {
  const summary = emptyProjectionOverlap();

  for (const artifact of artifacts) {
    const artifactPath = resolveArtifactPath(tracePath, artifact.path);
    let input: unknown;
    try {
      input = JSON.parse(await readFile(artifactPath, 'utf8'));
    } catch (error) {
      warnings.push(`projection_overlap_unavailable:${artifact.id}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const current = section(input, 'current');
    const interactions = refIds(section(current, 'interactions'));
    const readables = refIds(section(current, 'readables'));
    const navigation = refIds(section(current, 'navigation'));
    const interactionReadable = overlapCount(interactions, readables);
    const interactionNavigation = overlapCount(interactions, navigation);
    const readableNavigation = overlapCount(readables, navigation);
    const multiSection = multiSectionRefCount([interactions, readables, navigation]);

    summary.maxInteractionReadableOverlap = Math.max(summary.maxInteractionReadableOverlap, interactionReadable);
    summary.maxInteractionNavigationOverlap = Math.max(summary.maxInteractionNavigationOverlap, interactionNavigation);
    summary.maxReadableNavigationOverlap = Math.max(summary.maxReadableNavigationOverlap, readableNavigation);
    summary.maxMultiSectionRefCount = Math.max(summary.maxMultiSectionRefCount, multiSection);
  }

  return summary;
}

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

async function summarizePlannerInputSections(
  tracePath: string,
  artifacts: TraceArtifact[],
  warnings: string[],
): Promise<BenchmarkPlannerInputSectionDiagnostics> {
  const summary = emptyPlannerInputSections();

  for (const artifact of artifacts) {
    const artifactPath = resolveArtifactPath(tracePath, artifact.path);
    let input: unknown;
    try {
      input = JSON.parse(await readFile(artifactPath, 'utf8'));
    } catch (error) {
      warnings.push(`planner_input_section_unavailable:${artifact.id}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    addSectionSize(summary.goal, section(input, 'goal'));
    const current = section(input, 'current');
    addSectionSize(summary.current, current);
    addSectionSize(summary.currentInteractions, section(current, 'interactions'));
    addSectionSize(summary.currentReadables, section(current, 'readables'));
    addSectionSize(summary.currentNavigation, section(current, 'navigation'));
    addSectionSize(summary.currentRegions, section(current, 'regions'));
    addSectionSize(summary.continuity, section(input, 'continuity'));
    addSectionSize(summary.transition, section(input, 'transition'));
    addSectionSize(summary.lineage, section(input, 'lineage'));
    addSectionSize(summary.failures, section(input, 'failures'));
    addSectionSize(summary.deadState, section(input, 'deadState'));
    addSectionSize(summary.uncertainty, section(input, 'uncertainty'));
  }

  return summary;
}

function refIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(
    value
      .map(item => section(item, 'refId'))
      .filter((refId): refId is string => typeof refId === 'string' && refId.length > 0),
  );
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

function multiSectionRefCount(sections: Array<Set<string>>): number {
  const counts = new Map<string, number>();
  for (const sectionRefs of sections) {
    for (const refId of sectionRefs) {
      counts.set(refId, (counts.get(refId) ?? 0) + 1);
    }
  }
  return [...counts.values()].filter(count => count > 1).length;
}

function addSectionSize(summary: BenchmarkPayloadSizeSummary, value: unknown): void {
  if (value === undefined) {
    return;
  }

  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  summary.count += 1;
  summary.totalBytes += bytes;
  summary.maxBytes = Math.max(summary.maxBytes, bytes);
}

function section(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
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

async function fileSize(path: string, warnings: string[], label: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    warnings.push(`missing_artifact_size:${label}:${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

async function directorySize(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }

  return total;
}

function resolveArtifactPath(tracePath: string, artifactPath: string): string {
  return isAbsolute(artifactPath) ? artifactPath : join(dirname(tracePath), artifactPath);
}

function actionSignature(step: TraceStep): string {
  return JSON.stringify({
    kind: step.kind,
    targetRef: step.targetRef,
    input: step.input,
  });
}

function extractStepErrorCode(step: TraceStep): string | undefined {
  const result = step.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return undefined;
  }

  const error = result.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function emptyDiagnostics(): BenchmarkDiagnostics {
  return {
    payloads: {
      traceBytes: 0,
      observations: emptyPayloadSummary(),
      plannerInputs: emptyPayloadSummary(),
      plannerInputSections: emptyPlannerInputSections(),
      plannerOutputs: emptyPayloadSummary(),
      failures: emptyPayloadSummary(),
    },
    actions: {
      stepCount: 0,
      failedStepCount: 0,
      repeatedActionCount: 0,
      invalidActionCount: 0,
    },
    projectionOverlap: emptyProjectionOverlap(),
    workingSet: emptyWorkingSetDiagnostics(),
    warnings: [],
  };
}

function emptyProjectionOverlap(): BenchmarkProjectionOverlapDiagnostics {
  return {
    maxMultiSectionRefCount: 0,
    maxInteractionReadableOverlap: 0,
    maxInteractionNavigationOverlap: 0,
    maxReadableNavigationOverlap: 0,
  };
}

function emptyPlannerInputSections(): BenchmarkPlannerInputSectionDiagnostics {
  return {
    goal: emptyPayloadSummary(),
    current: emptyPayloadSummary(),
    currentInteractions: emptyPayloadSummary(),
    currentReadables: emptyPayloadSummary(),
    currentNavigation: emptyPayloadSummary(),
    currentRegions: emptyPayloadSummary(),
    continuity: emptyPayloadSummary(),
    transition: emptyPayloadSummary(),
    lineage: emptyPayloadSummary(),
    failures: emptyPayloadSummary(),
    deadState: emptyPayloadSummary(),
    uncertainty: emptyPayloadSummary(),
  };
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

function emptyPayloadSummary(): BenchmarkPayloadSizeSummary {
  return {
    count: 0,
    totalBytes: 0,
    maxBytes: 0,
  };
}
