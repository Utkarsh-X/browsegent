import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { V2OperationalError } from '../runtime/errors';
import type { BrowserObservation, TransitionEvidence, V2ToolResult } from '../runtime/types';
import type { FailureEvidence } from '../runtime/FailureClassifier';
import { createTransitionId, type ContinuityGraphSnapshot } from '../graph/types';
import { cloneTraceJson, stringifyTraceJson, toTraceJsonValue } from './serialize';
import type {
  TraceActionEndOptions,
  TraceActionStartInput,
  TraceArtifact,
  TraceFailureRecord,
  TraceGraphRecord,
  TraceManifest,
  TraceObservationRecord,
  TracePlannerRecord,
  TraceStep,
  TraceTransitionRecord,
  TraceStoreOptions,
} from './types';

export class TraceStore {
  private readonly runId: string;
  private readonly runtimeMode: TraceStoreOptions['runtimeMode'];
  private readonly traceDir: string;
  private readonly startTime: number;
  private readonly observations = new Map<string, TraceObservationRecord>();
  private readonly transitions = new Map<string, TraceTransitionRecord>();
  private readonly graphSnapshots = new Map<string, TraceGraphRecord>();
  private readonly plannerArtifacts = new Map<string, TracePlannerRecord>();
  private readonly compactPlannerViews = new Map<string, TracePlannerRecord>();
  private readonly failures = new Map<string, TraceFailureRecord>();
  private readonly refResolutionAudits = new Map<string, TracePlannerRecord>();
  private readonly steps: TraceStep[] = [];

  constructor(options: TraceStoreOptions) {
    this.runId = options.runId;
    this.runtimeMode = options.runtimeMode;
    this.traceDir = options.traceDir;
    this.startTime = options.startTime ?? Date.now();
  }

  recordObservation(observation: BrowserObservation): TraceArtifact {
    const safeObservation = cloneTraceJson(observation);
    const artifact = this.createArtifact('observation', observation.observationId, 'observations', `${observation.observationId}.json`);

    this.observations.set(observation.observationId, {
      artifact,
      observation: safeObservation,
    });

    return artifact;
  }

  recordPlannerInput(episodeId: string, input: unknown): TraceArtifact {
    return this.recordPlannerArtifact('planner_input', `${episodeId}-input`, input, 'planner', `${episodeId}-input.json`);
  }

  recordCompactPlannerInput(episodeId: string, input: unknown): TraceArtifact {
    return this.recordPlannerArtifact('compact_planner_input', `${episodeId}-compact-input`, input, 'planner', `${episodeId}-compact-input.json`);
  }

  recordPlannerOutput(episodeId: string, output: unknown): TraceArtifact {
    return this.recordPlannerArtifact('planner_output', `${episodeId}-output`, output, 'planner', `${episodeId}-output.json`);
  }

  recordCompactPlannerView(episodeId: string, payload: unknown): TraceArtifact {
    const id = `${episodeId}-compact`;
    const artifact = this.createArtifact('planner_compact_view', id, 'compact-planner', `${id}.json`);
    this.compactPlannerViews.set(id, {
      artifact,
      payload: toTraceJsonValue(payload),
    });
    return artifact;
  }

  recordRefResolutionAudit(auditId: string, payload: unknown): TraceArtifact {
    const artifact = this.createArtifact('ref_resolution_audit', auditId, 'ref-resolution', `${auditId}.json`);
    this.refResolutionAudits.set(auditId, {
      artifact,
      payload: toTraceJsonValue(payload),
    });
    return artifact;
  }

  recordTransition(evidence: TransitionEvidence): TraceArtifact {
    const transitionId = createTransitionId(evidence);
    const safeEvidence = cloneTraceJson(evidence);
    const artifact = this.createArtifact('transition', transitionId, 'transitions', `${transitionId}.json`);

    this.transitions.set(transitionId, {
      artifact,
      evidence: safeEvidence,
    });

    return artifact;
  }

  recordGraphSnapshot(snapshot: ContinuityGraphSnapshot): TraceArtifact {
    const safeSnapshot = cloneTraceJson(snapshot);
    const artifact = this.createArtifact('graph', snapshot.snapshotId, 'graph', `${snapshot.snapshotId}.json`);

    this.graphSnapshots.set(snapshot.snapshotId, {
      artifact,
      snapshot: safeSnapshot,
    });

    return artifact;
  }

  recordFailureEvidence(failure: FailureEvidence): TraceArtifact {
    const safeFailure = cloneTraceJson(failure);
    const artifact = this.createArtifact('failure', failure.failureId, 'failures', `${failure.failureId}.json`);

    this.failures.set(failure.failureId, {
      artifact,
      failure: safeFailure,
    });

    return artifact;
  }

  recordActionStart(input: TraceActionStartInput): string {
    const stepId = `step_${this.steps.length + 1}`;
    const step: TraceStep = {
      stepId,
      index: this.steps.length,
      kind: input.kind,
      status: 'started',
      startedAt: input.timestamp ?? Date.now(),
      warnings: cloneTraceJson(input.warnings ?? []),
    };

    assignIfDefined(step, 'targetRef', input.targetRef);
    assignIfDefined(step, 'beforeObservationId', input.beforeObservationId);
    assignIfDefined(step, 'input', input.input === undefined ? undefined : toTraceJsonValue(input.input));
    assignIfDefined(step, 'preconditions', input.preconditions === undefined ? undefined : toTraceJsonValue(input.preconditions));

    this.steps.push(step);
    return stepId;
  }

  recordActionEnd(stepId: string, result: V2ToolResult, options: TraceActionEndOptions = {}): TraceStep {
    const step = this.steps.find((candidate) => candidate.stepId === stepId);
    if (!step) {
      throw new V2OperationalError('trace_write_failed', `Trace step "${stepId}" was not recorded.`, { retryable: false });
    }

    step.status = result.success ? 'completed' : 'failed';
    step.endedAt = options.timestamp ?? Date.now();
    step.result = toTraceJsonValue(result);
    if (options.afterObservationId !== undefined) {
      step.afterObservationId = options.afterObservationId;
    }
    if (options.warnings?.length) {
      step.warnings = cloneTraceJson([...step.warnings, ...options.warnings]);
    }

    return cloneTraceJson(step);
  }

  async flush(): Promise<TraceManifest> {
    const manifest = this.createManifest();
    const runRoot = this.runRoot();

    try {
      await mkdir(join(runRoot, 'observations'), { recursive: true });
      await mkdir(join(runRoot, 'transitions'), { recursive: true });
      await mkdir(join(runRoot, 'graph'), { recursive: true });
      await mkdir(join(runRoot, 'planner'), { recursive: true });
      await mkdir(join(runRoot, 'compact-planner'), { recursive: true });
      await mkdir(join(runRoot, 'failures'), { recursive: true });
      await mkdir(join(runRoot, 'screenshots'), { recursive: true });
      await mkdir(join(runRoot, 'ref-resolution'), { recursive: true });

      for (const record of this.observations.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.observation), 'utf8');
      }
      for (const record of this.transitions.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.evidence), 'utf8');
      }
      for (const record of this.graphSnapshots.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.snapshot), 'utf8');
      }
      for (const record of this.plannerArtifacts.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.payload), 'utf8');
      }
      for (const record of this.compactPlannerViews.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.payload), 'utf8');
      }
      for (const record of this.failures.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.failure), 'utf8');
      }
      for (const record of this.refResolutionAudits.values()) {
        await writeFile(record.artifact.path, stringifyTraceJson(record.payload), 'utf8');
      }

      await writeFile(manifest.artifacts.trace.path, stringifyTraceJson(manifest), 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new V2OperationalError('trace_write_failed', `Failed to write v2 trace artifacts: ${message}`, { retryable: false });
    }

    return manifest;
  }

  private createManifest(): TraceManifest {
    return {
      runId: this.runId,
      runtimeMode: this.runtimeMode,
      startTime: this.startTime,
      steps: cloneTraceJson(this.steps),
      artifacts: {
        trace: this.createArtifact('trace', 'trace', 'trace.json'),
        observations: [...this.observations.values()].map((record) => record.artifact),
        transitions: [...this.transitions.values()].map((record) => record.artifact),
        graph: [...this.graphSnapshots.values()].map((record) => record.artifact),
        planner: [...this.plannerArtifacts.values()].map((record) => record.artifact),
        failures: [...this.failures.values()].map((record) => record.artifact),
        screenshots: [],
        compactPlannerViews: [...this.compactPlannerViews.values()].map((record) => record.artifact),
        refResolutionAudits: [...this.refResolutionAudits.values()].map((record) => record.artifact),
      },
    };
  }

  private createArtifact(kind: TraceArtifact['kind'], id: string, ...pathParts: string[]): TraceArtifact {
    return {
      kind,
      id,
      path: join(this.runRoot(), ...pathParts),
    };
  }

  private runRoot(): string {
    return join(this.traceDir, this.runId);
  }

  private recordPlannerArtifact(
    kind: 'planner_input' | 'compact_planner_input' | 'planner_output',
    id: string,
    payload: unknown,
    ...pathParts: string[]
  ): TraceArtifact {
    const artifact = this.createArtifact(kind, id, ...pathParts);
    this.plannerArtifacts.set(id, {
      artifact,
      payload: toTraceJsonValue(payload),
    });
    return artifact;
  }
}

function assignIfDefined<TObject extends object, TKey extends keyof TObject>(
  target: TObject,
  key: TKey,
  value: TObject[TKey] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
