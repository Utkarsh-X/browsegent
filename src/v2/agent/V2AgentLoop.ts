import { inferAnswerContract, validateAnswerAgainstContract } from './AnswerContract';
import { detectAnswerEvidenceConflicts } from './AnswerGrounding';
import { ProjectionService } from '../brain1/ProjectionService';
import {
  buildAnswerValidationEvidence,
  buildFinalizationEvidence,
  type ReadEvidenceHistoryEntry,
} from './FinalizationEvidence';
import { buildTaskEvidenceCoverage, type TaskEvidenceRead } from './TaskEvidenceCoverage';
import { EvidenceLedger } from './EvidenceLedger';
import type { OperationalProjection } from '../brain1/projectionTypes';
import { ContinuityGraph } from '../graph/ContinuityGraph';
import type { ContinuityGraphSnapshot } from '../graph/types';
import { BrowseGentV2Harness } from '../harness/BrowseGentV2Harness';
import { PlannerInputComposer } from '../planner/PlannerInputComposer';
import { V2PlannerClient } from '../planner/V2PlannerClient';
import { CompactPlannerClient } from '../planner/CompactPlannerClient';
import type { PlannerAnswerFeedback, PlannerInput, PlannerOutput, PlannerSerializationConfig, PlannerOutputStep } from '../planner/types';
import type { PlannerWorkingSetOptions } from '../planner/workingSetTypes';
import {
  buildCompactPlannerView,
  buildPlainInteractiveSnapshotBaseline,
  evaluateCompactPlannerCoverage,
  measureCompactPlannerView,
} from '../planner/CompactPlannerView';
import { DeadStateDetector, type DeadStateEvidence } from '../runtime/DeadStateDetector';
import { FailureClassifier, type FailureEvidence } from '../runtime/FailureClassifier';
import type { BrowserObservation, TransitionEvidence, V2ToolResult, V2ToolError } from '../runtime/types';
import { UncertaintySignals, type RuntimeUncertainty } from '../runtime/UncertaintySignals';
import { V2ToolDispatcher } from '../tools/V2ToolDispatcher';
import { LatencyLedger } from '../trace/LatencyLedger';
import { ActionOutcomeRecorder } from '../trace/ActionOutcomeRecord';
import type { TraceJsonValue, TraceStep } from '../trace/types';
import type {
  V2AgentHarnessRuntime,
  V2AgentLoopInput,
  V2AgentLoopOptions,
  V2AgentLoopResult,
  V2PlannerClientLike,
} from './types';

export class V2AgentLoop {
  private readonly projectionService = new ProjectionService();
  private readonly plannerInputComposer = new PlannerInputComposer();
  private readonly failureClassifier = new FailureClassifier();
  private readonly uncertaintySignals = new UncertaintySignals();
  private readonly deadStateDetector = new DeadStateDetector();

  constructor(private readonly options: V2AgentLoopOptions = {}) {}

  async run(input: V2AgentLoopInput): Promise<V2AgentLoopResult> {
    const harness = this.createHarness();
    const plannerClient = this.createPlannerClient(harness, input.plannerMode, input.plannerSerialization);
    const dispatcher = this.options.dispatcherFactory?.(harness) ?? new V2ToolDispatcher(harness);
    const graph = new ContinuityGraph();
    const maxSteps = Math.max(1, input.maxSteps);
    const progressMemory = new ActionProgressMemory();
    const metrics = {
      plannerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      plannerDurationMs: 0,
      toolExecutions: 0,
      postActionObservationReuseCount: 0,
      postActionObservationRecaptureCount: 0,
    };

    try {
      const ledger = new LatencyLedger();
      const outcomeRecorder = new ActionOutcomeRecorder();
      harness.setLatencyLedger?.(ledger);
      let observation = await harness.open(input.url);
      let graphSnapshot = graph.applyObservation(observation);
      let lastResult: V2ToolResult | undefined;
      let transitionEvidence: TransitionEvidence | undefined;
      let failureEvidence: FailureEvidence[] = [];
      let deadStateEvidence: DeadStateEvidence | undefined;
      let runtimeUncertainty: RuntimeUncertainty | undefined;
      let lastSuccessfulEvidenceValue: string | undefined;
      let readEvidenceHistory: ReadEvidenceHistoryEntry[] = [];
      let answerFeedback: PlannerAnswerFeedback | undefined;
      let lastRejectedAnswerKey: string | undefined;
      let repeatedRejectedAnswerCount = 0;
      const evidenceLedger = new EvidenceLedger();
      const plannerTraceSteps: TraceStep[] = [];

      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        ledger.beginStep(stepIndex);
        const stepStartMs = Date.now();
        const composeStart = Date.now();
        const projection = this.projectionService.project(observation, graphSnapshot);
        evidenceLedger.recordObservation(observation, projection);
        const surfaceEvidence = evidenceLedger.getAllEvidenceReads();
        const evidenceCoverage = buildTaskEvidenceCoverage(input.goal, readEvidenceHistory, surfaceEvidence);
        const plannerInput = this.plannerInputComposer.compose({
          episodeId: `episode_${stepIndex + 1}_${observation.observationId}`,
          goal: input.goal,
          projection,
          graphSnapshot,
          transitionEvidence,
          lastResult,
          failureEvidence: failureEvidence.length > 0 ? failureEvidence : undefined,
          deadStateEvidence,
          runtimeUncertainty,
          answerFeedback,
          evidenceCoverage,
          evidenceSnapshot: evidenceLedger.getPlannerEvidenceSnapshot(),
          workingSetOptions: input.workingSetOptions,
          trace: plannerTraceSteps.length > 0 ? plannerTraceSteps : undefined,
          maxLineageSteps: 5,
        });
        harness.recordPlannerInput?.(plannerInput.episodeId, plannerInput);
        ledger.recordPhase('local_compute', Date.now() - composeStart);
        metrics.plannerCalls += 1;
        let plannerResult: Awaited<ReturnType<V2PlannerClientLike['call']>>;
        const providerStart = Date.now();
        let pacingWaitMs = 0;
        try {
          plannerResult = await plannerClient.call({
            plannerInput,
            model: input.model,
            onPacingWait: durationMs => {
              pacingWaitMs += durationMs;
              ledger.recordPhase('provider_pacing_wait', durationMs);
            },
          });
        } catch (error) {
          ledger.recordPhase('provider', Math.max(0, Date.now() - providerStart - pacingWaitMs));
          recordCompactPlannerTelemetry({
            harness,
            plannerInput,
            mode: 'normal',
          });
          const plannerMetrics = readPlannerErrorMetrics(error);
          metrics.inputTokens += plannerMetrics.inputTokens;
          metrics.outputTokens += plannerMetrics.outputTokens;
          metrics.plannerDurationMs += plannerMetrics.durationMs;
          if (error && (error as any).code === 'COMPACT_PLANNER_INPUT_INELIGIBLE') {
            return await this.complete(harness, {
              success: false,
              value: '',
              failureReason: 'compact_planner_input_ineligible',
              steps: metrics.plannerCalls,
              metrics,
            }, ledger, outcomeRecorder);
          }
          if (isPlannerInvalidOutputError(error)) {
            return await this.complete(harness, {
              success: false,
              value: '',
              failureReason: 'planner_invalid_output_dead_end',
              steps: metrics.plannerCalls,
              metrics,
            }, ledger, outcomeRecorder);
          }
          return await this.complete(harness, {
            success: false,
            value: '',
            failureReason: `planner_client_error:${formatErrorMessage(error)}`,
            steps: metrics.plannerCalls,
            metrics,
          }, ledger, outcomeRecorder);
        }
        ledger.recordPhase('provider', Math.max(0, Date.now() - providerStart - pacingWaitMs));
        recordCompactPlannerTelemetry({
          harness,
          plannerInput,
          plannerOutput: plannerResult.output,
          mode: 'normal',
        });
        if (this.options.plannerClient) {
          harness.recordPlannerOutput?.(plannerInput.episodeId, {
            attempts: 1,
            rawText: plannerResult.rawText,
            validation: { ok: true, errors: [] },
            output: plannerResult.output,
            metrics: {
              inputTokens: plannerResult.inputTokens,
              outputTokens: plannerResult.outputTokens,
              durationMs: plannerResult.durationMs,
            },
          });
        }

        metrics.inputTokens += plannerResult.inputTokens;
        metrics.outputTokens += plannerResult.outputTokens;
        metrics.plannerDurationMs += plannerResult.durationMs;

        if (plannerResult.output.done === true) {
            const value = normalizeAnswerValue(plannerResult.output.val ?? '', input.goal);
            const answerValidation = validateAnswerAgainstContract(value, inferAnswerContract(input.goal), {
              evidenceText: buildAnswerValidationEvidence(readEvidenceHistory, surfaceEvidence, evidenceLedger),
            });
          const coverageReasons = answerValidation.ok ? missingCoverageReasons(evidenceCoverage) : [];
          const validationReasons = [...answerValidation.reasons, ...coverageReasons];
          if (validationReasons.length > 0) {
            const rejectedAnswerKey = buildRejectedAnswerKey(
              value,
              validationReasons,
              observation,
              readEvidenceHistory,
            );
            repeatedRejectedAnswerCount = rejectedAnswerKey === lastRejectedAnswerKey
              ? repeatedRejectedAnswerCount + 1
              : 1;
            lastRejectedAnswerKey = rejectedAnswerKey;
            if (repeatedRejectedAnswerCount >= 3) {
              return await this.complete(harness, {
                success: false,
                value,
                failureReason: `planner_repeated_answer_rejection:${validationReasons.join('|')}`,
                steps: metrics.plannerCalls,
                metrics,
              }, ledger, outcomeRecorder);
            }
            if (stepIndex < maxSteps - 1) {
              answerFeedback = buildAnswerFeedback(
                value,
                validationReasons,
                repeatedRejectedAnswerCount >= 2,
              );
              runtimeUncertainty = appendRuntimeUncertaintySignals(
                runtimeUncertainty,
                validationReasons.map(reason => `answer_contract:${reason}`),
              );
              ledger.endStep(stepIndex, Date.now() - stepStartMs);
              continue;
            }
            return await this.complete(harness, {
              success: false,
              value,
              failureReason: `answer_contract_failed:${validationReasons.join('|')}`,
              steps: metrics.plannerCalls,
              metrics,
            }, ledger, outcomeRecorder);
          }
          answerFeedback = undefined;
          return await this.complete(harness, {
            success: true,
            value,
            steps: metrics.plannerCalls,
            metrics,
          }, ledger, outcomeRecorder);
        }

        if (plannerResult.output.escalate) {
          return await this.complete(harness, {
            success: false,
            value: '',
            failureReason: formatPlannerEscalation(plannerResult.output.escalate, plannerResult.output.reason),
            steps: metrics.plannerCalls,
            metrics,
          }, ledger, outcomeRecorder);
        }

        const plan = plannerResult.output.plan ?? [];
        if (plan.length === 0) {
          return await this.complete(harness, {
            success: false,
            value: '',
            failureReason: 'planner_no_action',
            steps: metrics.plannerCalls,
            metrics,
          }, ledger, outcomeRecorder);
        }

        for (let planIndex = 0; planIndex < plan.length; planIndex += 1) {
          const plannedStep = plan[planIndex];
          const actionObservation = observation;
          let preExecutionRejected = false;

          // Guard 1: hard-block
          const blockedSig = progressMemory.isHardBlocked(plannedStep, actionObservation);
          if (blockedSig) {
            const blockDescription = blockedSig.startsWith('tool:')
              ? `the ${plannedStep.tool} tool produced no progress three times`
              : blockedSig.startsWith('persistent_target:')
                ? `persistent mutation failures on semantic target ${blockedSig.slice('persistent_target:'.length)}`
                : `3 identical repeats (signature: ${blockedSig})`;
            lastResult = {
              success: false,
              kind: plannedStep.tool,
              targetRef: plannedStep.ref,
              error: {
                code: 'action_blocked_by_loop_detector',
                message: `Action ${plannedStep.tool} on ${plannedStep.ref ?? 'global'} blocked after ${blockDescription}. You MUST choose a different action, ref, or value.`,
                retryable: true,
              },
              traceStepId: `blocked_${stepIndex}`,
            };
            preExecutionRejected = true;
            outcomeRecorder.record({
              stepIndex, tool: plannedStep.tool, targetRef: plannedStep.ref,
              source: 'hard_block', success: false, errorCode: 'action_blocked_by_loop_detector',
              stateChanged: false, readEvidenceProduced: false,
            });
          }

          // Guard 2: step validation (only if guard 1 didn't fire)
          if (!preExecutionRejected) {
            const stepError = validatePlannerStep(plannedStep);
            if (stepError) {
              lastResult = {
                success: false,
                kind: plannedStep.tool,
                targetRef: plannedStep.ref,
                error: stepError,
                traceStepId: `invalid_${stepIndex}`,
              };
              preExecutionRejected = true;
              outcomeRecorder.record({
                stepIndex, tool: plannedStep.tool, targetRef: plannedStep.ref,
                source: 'pre_execution_guard', success: false, errorCode: stepError.code,
                stateChanged: false, readEvidenceProduced: false,
              });
            }
          }

          // Dispatch (only if no pre-execution rejection)
          if (!preExecutionRejected) {
            lastResult = await dispatcher.dispatch(plannedStep, { goal: input.goal });
            metrics.toolExecutions += 1;
            transitionEvidence = lastResult.evidence;
            const capturedAfterAction = transitionEvidence?.afterObservationId
              ? harness.getCurrentObservation?.()
              : undefined;
            // Mutation tools already capture the observation named by their
            // transition evidence. Avoid a second immediate capture, which
            // can observe a transient loading shell and add avoidable cost.
            // Low-information click/press transitions are the exception:
            // delayed menus and comboboxes may not exist in the captured
            // snapshot yet, so one fresh capture is required before planning.
            const refreshLowInformationAction = shouldRefreshAfterLowInformationAction(
              plannedStep,
              transitionEvidence,
            );
            if (capturedAfterAction !== undefined
              && capturedAfterAction.observationId === transitionEvidence?.afterObservationId
              && !refreshLowInformationAction) {
              metrics.postActionObservationReuseCount += 1;
              observation = capturedAfterAction;
            } else {
              metrics.postActionObservationRecaptureCount += 1;
              observation = await harness.observe();
            }
            graphSnapshot = graph.applyObservation(observation);
            if (transitionEvidence) {
              graphSnapshot = graph.applyTransition(transitionEvidence);
            }
            lastSuccessfulEvidenceValue = successfulToolEvidencePreview(lastResult) ?? lastSuccessfulEvidenceValue;
            readEvidenceHistory = appendReadEvidenceHistory(readEvidenceHistory, lastResult);
            const latestRead = readEvidenceHistory[readEvidenceHistory.length - 1];
            if (latestRead) {
              evidenceLedger.recordToolRead({
                kind: latestRead.kind,
                targetRef: latestRead.targetRef,
                text: latestRead.text,
                sourceKind: 'tool_read',
              });
            }
            outcomeRecorder.record({
              stepIndex, tool: plannedStep.tool, targetRef: plannedStep.ref,
              source: 'dispatch', success: lastResult.success, errorCode: lastResult.error?.code,
              stateChanged: !!(lastResult.evidence?.urlChanged || lastResult.evidence?.generationChanged),
              observableEffect: hasObservableEffect(lastResult.evidence),
              readEvidenceProduced: isReadEvidence(lastResult),
              inputApplied: lastResult.success && (plannedStep.tool === 'type' || plannedStep.tool === 'select'),
            });
          }

          plannerTraceSteps.push(buildPlannerLineageStep(
            plannerTraceSteps.length,
            plannedStep,
            lastResult!,
            actionObservation.observationId,
            observation.observationId,
          ));

          // Record progress for ALL outcomes (dispatched and pre-execution)
          const progressSignals = progressMemory.record(lastResult!, plannedStep, actionObservation);
          if (!preExecutionRejected && lastResult!.success) {
            progressMemory.resetSignatureOnPageChange(lastResult!.evidence);
          }

          // Unified failure pipeline — handles BOTH pre-execution rejections AND dispatched failures
          if (!lastResult!.success) {
            if (preExecutionRejected) transitionEvidence = undefined;
            const progressAfterError = hasProgressAfterError(lastResult!);
            const currentProjection = this.projectionService.project(observation, graphSnapshot);
            const failure = this.failureClassifier.classify(lastResult!, {
              observationId: observation.observationId,
              generationId: graphSnapshot.generationId,
              url: graphSnapshot.url,
              projection: currentProjection,
              targetRef: lastResult!.targetRef,
              source: preExecutionRejected ? 'pre_execution_guard' : 'v2_agent_loop',
            });
            harness.recordFailureEvidence?.(failure);

            if (progressAfterError) {
              runtimeUncertainty = appendRuntimeUncertaintySignals(
                runtimeUncertainty,
                [`progress_after_error:${lastResult!.error?.code ?? 'unknown'}`],
              );
              deadStateEvidence = undefined;
              break; // Replan from the fresh observation; preserve the raw failure in telemetry.
            }

            failureEvidence = appendBoundedFailure(failureEvidence, failure);
            const uncertainty = this.uncertaintySignals.fromRuntimeState({
              projection: currentProjection,
              transitionEvidence,
              graphSnapshot,
              failures: failureEvidence,
              extraSignals: progressSignals,
            });
            const deadState = this.deadStateDetector.assess({
              projection: currentProjection,
              failures: failureEvidence,
              uncertainty,
              localMechanismsExhausted: true,
            });
            deadStateEvidence = deadState.evidence;
            runtimeUncertainty = this.uncertaintySignals.fromRuntimeState({
              projection: currentProjection,
              transitionEvidence,
              graphSnapshot,
              failures: failureEvidence,
              deadStateEvidence,
              extraSignals: progressSignals,
            });
            break; // break mini-plan → replan
          }

          // Success path — only reachable from dispatched actions
          if (hasPageBoundary(transitionEvidence)) {
            // Failure and dead-state evidence is scoped to the previous page.
            // Preserve task evidence and the transition itself, but do not
            // make the planner recover from a target it can no longer see.
            failureEvidence = [];
            deadStateEvidence = undefined;
          }
          runtimeUncertainty = undefined;
          if (progressSignals.length > 0) {
            const currentProjection = this.projectionService.project(observation, graphSnapshot);
            runtimeUncertainty = this.uncertaintySignals.fromRuntimeState({
              projection: currentProjection,
              transitionEvidence,
              graphSnapshot,
              failures: failureEvidence,
              deadStateEvidence,
              extraSignals: progressSignals,
            });
          }

          const nextStep = plan[planIndex + 1];
          if (!shouldContinueMiniPlan({ lastResult: lastResult!, nextStep, freshObservation: observation })) {
            break;
          }
        }

        ledger.endStep(stepIndex, Date.now() - stepStartMs);

      }

      if (lastSuccessfulEvidenceValue) {
        const finalizationResult = await this.attemptFinalization(
          harness, plannerClient, observation, graphSnapshot,
          input.goal, lastSuccessfulEvidenceValue, readEvidenceHistory, metrics, ledger, outcomeRecorder,
          input.workingSetOptions,
          evidenceLedger,
          plannerTraceSteps,
        );
        if (finalizationResult) return finalizationResult;

        return await this.complete(harness, {
          success: false,
          value: lastSuccessfulEvidenceValue,
          failureReason: 'v2_max_steps_exhausted',
          steps: metrics.plannerCalls,
          metrics,
        }, ledger, outcomeRecorder);
      }

      return await this.complete(harness, {
        success: false,
        value: '',
        failureReason: 'v2_max_steps_exhausted',
        steps: metrics.plannerCalls,
        metrics,
      }, ledger, outcomeRecorder);
    } finally {
      await harness.close();
    }
  }

  private createHarness(): V2AgentHarnessRuntime {
    if (this.options.harnessFactory) {
      return this.options.harnessFactory();
    }

    return new BrowseGentV2Harness({
      headed: this.options.headed ?? true,
      traceDir: this.options.traceDir,
      runId: this.options.runId,
      runtimeMode: 'agent',
      viewport: this.options.viewport,
    });
  }

  private createPlannerClient(
    harness: V2AgentHarnessRuntime,
    plannerMode?: 'current' | 'compact_enforced',
    plannerSerialization?: PlannerSerializationConfig,
  ): V2PlannerClientLike {
    if (this.options.plannerClient) {
      return this.options.plannerClient;
    }

    const recordPlannerInput = harness.recordPlannerInput?.bind(harness);
    const recordCompactPlannerInput = harness.recordCompactPlannerInput?.bind(harness);
    const recordPlannerOutput = harness.recordPlannerOutput?.bind(harness);

    const traceStore = recordPlannerInput && recordPlannerOutput
      ? {
          recordPlannerInput,
          recordCompactPlannerInput,
          recordPlannerOutput,
        }
      : undefined;

    if (plannerMode === 'compact_enforced') {
      return new CompactPlannerClient({
        traceStore,
      });
    }

    return new V2PlannerClient({
      traceStore,
      plannerSerialization,
    });
  }

  private async complete(
    harness: V2AgentHarnessRuntime,
    result: Omit<V2AgentLoopResult, 'tracePath'>,
    ledger?: LatencyLedger,
    outcomeRecorder?: ActionOutcomeRecorder,
  ): Promise<V2AgentLoopResult> {
    if (ledger) {
      ledger.closeActiveStep();
      const summary = ledger.summarize();
      harness.recordLatencyLedger?.(summary);
    }
    if (outcomeRecorder) {
      harness.recordActionOutcomes?.(outcomeRecorder.toJSON());
    }
    const manifest = await harness.flushTrace();
    return {
      ...result,
      tracePath: manifest.artifacts.trace.path,
    };
  }

  private async attemptFinalization(
    harness: V2AgentHarnessRuntime,
    plannerClient: V2PlannerClientLike,
    observation: BrowserObservation,
    graphSnapshot: ContinuityGraphSnapshot | undefined,
    goal: string,
    evidenceValue: string,
    readEvidenceHistory: ReadEvidenceHistoryEntry[],
    metrics: { plannerCalls: number; inputTokens: number; outputTokens: number; plannerDurationMs: number; toolExecutions: number },
    ledger?: LatencyLedger,
    outcomeRecorder?: ActionOutcomeRecorder,
    workingSetOptions?: PlannerWorkingSetOptions,
    evidenceLedger?: EvidenceLedger,
    trace?: TraceStep[],
  ): Promise<V2AgentLoopResult | undefined> {
    const projection = this.projectionService.project(observation, graphSnapshot);
    const ledgerInstance = evidenceLedger ?? new EvidenceLedger();
    ledgerInstance.recordObservation(observation, projection);
    const surfaceEvidence = ledgerInstance.getAllEvidenceReads();
    const evidenceCoverage = buildTaskEvidenceCoverage(goal, readEvidenceHistory, surfaceEvidence);
    const finalizationEvidence = buildFinalizationEvidence({
      goal,
      projection,
      lastSuccessfulEvidenceValue: evidenceValue,
      readEvidenceHistory,
      evidenceCoverage,
    });
    const validationEvidence = buildAnswerValidationEvidence(readEvidenceHistory, surfaceEvidence, ledgerInstance);
    const finalizationInput = this.plannerInputComposer.compose({
      episodeId: `episode_finalization_${observation.observationId}`,
      goal: `${goal}\n\nFinalization evidence:\n${finalizationEvidence}\n\nReturn done with the best answer if the evidence answers the goal. Otherwise escalate with a concise reason. Do not return a plan.`,
      projection,
      graphSnapshot,
      evidenceCoverage,
      evidenceSnapshot: ledgerInstance.getPlannerEvidenceSnapshot(),
      workingSetOptions,
      trace: trace && trace.length > 0 ? trace : undefined,
      maxLineageSteps: 5,
    });
    harness.recordPlannerInput?.(finalizationInput.episodeId, finalizationInput);
    metrics.plannerCalls += 1;
    const providerStart = Date.now();
    let pacingWaitMs = 0;
    try {
      const result = await plannerClient.call({
        plannerInput: finalizationInput,
        mode: 'finalization',
        onPacingWait: durationMs => {
          pacingWaitMs += durationMs;
          ledger?.recordPhase('provider_pacing_wait', durationMs);
        },
      });
      ledger?.recordPhase('provider', Math.max(0, Date.now() - providerStart - pacingWaitMs));
      recordCompactPlannerTelemetry({
        harness,
        plannerInput: finalizationInput,
        plannerOutput: result.output,
        mode: 'finalization',
      });
      if (this.options.plannerClient) {
        harness.recordPlannerOutput?.(finalizationInput.episodeId, {
          attempts: 1,
          rawText: result.rawText,
          validation: { ok: true, errors: [] },
          output: result.output,
          metrics: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            durationMs: result.durationMs,
          },
        });
      }
      metrics.inputTokens += result.inputTokens;
      metrics.outputTokens += result.outputTokens;
      metrics.plannerDurationMs += result.durationMs;

      if (result.output.done === true) {
        const value = result.output.val ?? evidenceValue;
        const answerValidation = validateAnswerAgainstContract(value, inferAnswerContract(goal), {
          evidenceText: validationEvidence,
        });
        const validationReasons = [
          ...answerValidation.reasons,
          ...(answerValidation.ok ? missingCoverageReasons(evidenceCoverage) : []),
        ];
        if (validationReasons.length > 0) {
          return await this.complete(harness, {
            success: false,
            value,
            failureReason: `answer_contract_failed:${validationReasons.join('|')}`,
            steps: metrics.plannerCalls,
            metrics,
          }, ledger, outcomeRecorder);
        }
        const groundedValue = await this.reconcileAnswerGrounding({
          harness,
          plannerClient,
          observation,
          graphSnapshot,
          evidenceCoverage,
          goal,
          draftAnswer: value,
          validationEvidence,
          metrics,
          ledger,
          outcomeRecorder,
          workingSetOptions,
          trace,
        });
        return await this.complete(harness, {
          success: true,
          value: groundedValue,
          steps: metrics.plannerCalls,
          metrics,
        }, ledger, outcomeRecorder);
      }
    } catch {
      ledger?.recordPhase('provider', Math.max(0, Date.now() - providerStart - pacingWaitMs));
      recordCompactPlannerTelemetry({
        harness,
        plannerInput: finalizationInput,
        mode: 'finalization',
      });
      // Finalization planner call failed — fall through to max_steps_exhausted
    }
    return undefined;
  }

  /**
   * Bounded grounding reconciliation: when deterministic claim-vs-read checks find
   * draft-answer values absent from captured read evidence, give the planner exactly
   * one opportunity to correct them from page facts. Any failure or escalation keeps
   * the original draft, so this can only refine — never block — an accepted answer.
   */
  private async reconcileAnswerGrounding(input: {
    harness: V2AgentHarnessRuntime;
    plannerClient: V2PlannerClientLike;
    observation: BrowserObservation;
    graphSnapshot: ContinuityGraphSnapshot | undefined;
    evidenceCoverage: ReturnType<typeof buildTaskEvidenceCoverage>;
    goal: string;
    draftAnswer: string;
    validationEvidence: string;
    metrics: { plannerCalls: number; inputTokens: number; outputTokens: number; plannerDurationMs: number; toolExecutions: number };
    ledger?: LatencyLedger;
    outcomeRecorder?: ActionOutcomeRecorder;
    workingSetOptions?: PlannerWorkingSetOptions;
    trace?: TraceStep[];
  }): Promise<string> {
    const grounding = detectAnswerEvidenceConflicts(input.draftAnswer, input.validationEvidence);
    if (grounding.conflicts.length === 0) {
      return input.draftAnswer;
    }
    const conflictBlock = [
      'Answer grounding check found draft-answer values that do not appear in the captured read evidence:',
      ...grounding.conflicts.map(conflict =>
        `- draft states ${conflict.claim}; read evidence contains ${conflict.evidenceValue} (${conflict.dimension})`,
      ),
    ].join('\n');
    const projection = this.projectionService.project(input.observation, input.graphSnapshot);
    const reconciliationInput = this.plannerInputComposer.compose({
      episodeId: `episode_finalization_grounding_${input.observation.observationId}`,
      goal: [
        input.goal,
        `Draft answer: ${input.draftAnswer}`,
        conflictBlock,
        'Reconcile using only facts present in the read evidence and return done with the corrected best answer. If no read supports a value, use the value the reads contain.',
      ].join('\n\n'),
      projection,
      graphSnapshot: input.graphSnapshot,
      evidenceCoverage: input.evidenceCoverage,
      workingSetOptions: input.workingSetOptions,
      trace: input.trace && input.trace.length > 0 ? input.trace : undefined,
      maxLineageSteps: 5,
    });
    input.harness.recordPlannerInput?.(reconciliationInput.episodeId, reconciliationInput);
    input.metrics.plannerCalls += 1;
    const providerStart = Date.now();
    let pacingWaitMs = 0;
    try {
      const result = await input.plannerClient.call({
        plannerInput: reconciliationInput,
        mode: 'finalization',
        onPacingWait: durationMs => {
          pacingWaitMs += durationMs;
          input.ledger?.recordPhase('provider_pacing_wait', durationMs);
        },
      });
      input.ledger?.recordPhase('provider', Math.max(0, Date.now() - providerStart - pacingWaitMs));
      recordCompactPlannerTelemetry({
        harness: input.harness,
        plannerInput: reconciliationInput,
        plannerOutput: result.output,
        mode: 'finalization',
      });
      if (this.options.plannerClient) {
        input.harness.recordPlannerOutput?.(reconciliationInput.episodeId, {
          attempts: 1,
          rawText: result.rawText,
          validation: { ok: true, errors: [] },
          output: result.output,
          metrics: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            durationMs: result.durationMs,
          },
        });
      }
      input.metrics.inputTokens += result.inputTokens;
      input.metrics.outputTokens += result.outputTokens;
      input.metrics.plannerDurationMs += result.durationMs;
      const corrected = result.output.done === true ? result.output.val?.trim() : undefined;
      if (corrected) {
        // Shape and coverage are re-validated; grounding is not re-run so this is bounded.
        const validation = validateAnswerAgainstContract(corrected, inferAnswerContract(input.goal), {
          evidenceText: input.validationEvidence,
        });
        const reasons = [
          ...validation.reasons,
          ...(validation.ok ? missingCoverageReasons(input.evidenceCoverage) : []),
        ];
        if (reasons.length === 0) {
          return corrected;
        }
      }
    } catch {
      input.ledger?.recordPhase('provider', Math.max(0, Date.now() - providerStart - pacingWaitMs));
      recordCompactPlannerTelemetry({
        harness: input.harness,
        plannerInput: reconciliationInput,
        mode: 'finalization',
      });
      // Reconciliation is best-effort; keep the original draft on provider failure.
    }
    return input.draftAnswer;
  }
}

function recordCompactPlannerTelemetry(input: {
  harness: V2AgentHarnessRuntime;
  plannerInput: PlannerInput;
  plannerOutput?: PlannerOutput;
  mode: 'normal' | 'finalization';
}): void {
  if (!input.harness.recordCompactPlannerView) {
    return;
  }

  const compactView = buildCompactPlannerView(input.plannerInput);
  const baseline = buildPlainInteractiveSnapshotBaseline(input.plannerInput);
  const stats = measureCompactPlannerView(input.plannerInput, compactView, baseline);
  const coverage = evaluateCompactPlannerCoverage(compactView, input.plannerOutput);

  input.harness.recordCompactPlannerView(input.plannerInput.episodeId, {
    version: 'compact_planner_telemetry.v1',
    episodeId: input.plannerInput.episodeId,
    mode: input.mode,
    plannerInputVersion: input.plannerInput.version,
    stats,
    coverage,
    observationEpoch: compactView.observationEpoch,
    omitted: compactView.omitted,
    view: compactView,
    plainInteractiveBaseline: baseline,
  });
}

function buildPlannerLineageStep(
  index: number,
  plannedStep: PlannerOutputStep,
  result: V2ToolResult,
  beforeObservationId: string,
  afterObservationId: string,
): TraceStep {
  const resultSummary: Record<string, TraceJsonValue> = {
    success: result.success,
    kind: result.kind,
  };
  const targetRef = result.targetRef ?? plannedStep.ref;
  if (targetRef) {
    resultSummary.targetRef = targetRef;
  }
  if (result.error) {
    resultSummary.error = {
      code: result.error.code,
      retryable: result.error.retryable,
    };
  }
  if (result.evidence) {
    resultSummary.evidence = {
      transitionClass: result.evidence.transitionClass,
      strength: result.evidence.strength,
    };
  }

  const now = Date.now();
  const actionInput: Record<string, TraceJsonValue> = {};
  for (const [key, value] of Object.entries({
    text: plannedStep.text,
    value: plannedStep.value,
    url: plannedStep.url,
    pattern: plannedStep.pattern,
  })) {
    if (typeof value === 'string' && value.length > 0) {
      actionInput[key] = value.slice(0, 160);
    }
  }
  return {
    stepId: result.traceStepId,
    index,
    kind: plannedStep.tool,
    status: result.success ? 'completed' : 'failed',
    startedAt: now,
    endedAt: now,
    targetRef,
    beforeObservationId,
    afterObservationId,
    input: Object.keys(actionInput).length > 0 ? actionInput : undefined,
    warnings: [],
    result: resultSummary,
  };
}

function appendBoundedFailure(existing: FailureEvidence[], next: FailureEvidence): FailureEvidence[] {
  return [...existing, next].slice(-8);
}

function appendReadEvidenceHistory(
  existing: ReadEvidenceHistoryEntry[],
  result: V2ToolResult,
): ReadEvidenceHistoryEntry[] {
  if (!result.success || !READ_TOOL_KINDS.has(result.kind)) {
    return existing;
  }

  const text = richResultEvidenceText(result.value);
  if (!text) {
    return existing;
  }

  const entry: ReadEvidenceHistoryEntry = {
    kind: result.kind,
    targetRef: result.targetRef,
    text,
  };
  const normalized = normalizeProgressValue(`${entry.kind}:${entry.targetRef ?? 'global'}:${entry.text}`);
  const withoutDuplicate = existing.filter(previous =>
    normalizeProgressValue(`${previous.kind}:${previous.targetRef ?? 'global'}:${previous.text}`) !== normalized
  );

  return [...withoutDuplicate, entry].slice(-READ_EVIDENCE_HISTORY_LIMIT);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatPlannerEscalation(kind: string, reason: string | undefined): string {
  const compactReason = reason?.replace(/\s+/g, ' ').trim();
  return compactReason ? `planner_escalated:${kind}:${compactReason}` : `planner_escalated:${kind}`;
}

function buildAnswerFeedback(
  previousAnswer: string,
  missingDetails: string[],
  forceStrategyPivot = false,
): PlannerAnswerFeedback {
  return {
    previousAnswer,
    missingDetails,
    instruction: forceStrategyPivot
      ? 'The same done answer was rejected again without new evidence. Do not return done again. Execute a different evidence-gathering action or escalate if the page is blocked.'
      : 'Previous done answer did not satisfy the answer contract. Continue gathering evidence or return done only when all missing details are answered.',
  };
}

function buildRejectedAnswerKey(
  answer: string,
  reasons: string[],
  observation: BrowserObservation,
  readEvidenceHistory: ReadEvidenceHistoryEntry[],
): string {
  const evidence = readEvidenceHistory
    .map(entry => `${entry.kind}:${entry.targetRef ?? ''}:${entry.text}`)
    .join('|');
  return `${observation.observationId}|${reasons.join('|')}|${answer}|${evidence}`;
}

function appendRuntimeUncertaintySignals(
  existing: RuntimeUncertainty | undefined,
  signals: string[],
): RuntimeUncertainty {
  return {
    level: existing?.level ?? 'medium',
    signals: [...(existing?.signals ?? []), ...signals].slice(-12),
  };
}

function readPlannerErrorMetrics(error: unknown): { inputTokens: number; outputTokens: number; durationMs: number } {
  if (!error || typeof error !== 'object') {
    return { inputTokens: 0, outputTokens: 0, durationMs: 0 };
  }

  const candidate = error as { inputTokens?: unknown; outputTokens?: unknown; durationMs?: unknown };
  return {
    inputTokens: numberOrZero(candidate.inputTokens),
    outputTokens: numberOrZero(candidate.outputTokens),
    durationMs: numberOrZero(candidate.durationMs),
  };
}

function isPlannerInvalidOutputError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
  if (candidate.code === 'PLANNER_INVALID_OUTPUT') {
    return true;
  }

  if (candidate.name === 'PlannerInvalidOutputError') {
    return true;
  }

  return typeof candidate.message === 'string'
    && candidate.message.includes('Planner output invalid after retry');
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const READ_TOOL_KINDS = new Set(['get', 'inspect_region', 'search_page']);
const MUTATION_EVIDENCE_KINDS = new Set(['click', 'type', 'select', 'press', 'navigate']);
const TARGET_MUTATION_KINDS = new Set(['click', 'type', 'select', 'press']);

/**
 * Determine if a tool result produced read evidence.
 * Only successful get, inspect_region, or search_page with non-empty text qualify.
 * Mutation previews (click/type/press/select/navigate) are NOT read evidence.
 */
function isReadEvidence(result: V2ToolResult): boolean {
  if (!result.success || !READ_TOOL_KINDS.has(result.kind)) return false;
  if (result.kind === 'search_page') {
    const val = result.value as { text?: string } | undefined;
    return !!val?.text;
  }
  return true; // get and inspect_region always produce read evidence when successful
}

function missingCoverageReasons(coverage: ReturnType<typeof buildTaskEvidenceCoverage>): string[] {
  return coverage.requirements
    .filter(requirement => requirement.status === 'missing' || requirement.status === 'conflicting')
    .map(requirement => `missing_evidence_${requirement.key}`);
}

function extractSurfaceEvidence(projection: OperationalProjection, observationId: string): TaskEvidenceRead[] {
  const seenRefs = new Set<string>();
  const surfaceReads: TaskEvidenceRead[] = [];

  for (const item of [
    ...(projection.readables ?? []),
    ...(projection.interactions ?? []),
    ...(projection.navigation ?? []),
  ]) {
    if (seenRefs.has(item.refId)) continue;
    seenRefs.add(item.refId);

    if (item.visibility !== 'visible') continue;
    const text = [item.name, item.text].filter(Boolean).join(' ').trim();
    if (!text) continue;

    surfaceReads.push({
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId,
      targetRef: item.refId,
      refIds: [item.refId],
      text,
    });
  }

  return surfaceReads;
}

/**
 * Keep URL/generation changes separate from any observable page transition.
 * Local structural changes and weak geometry changes are still useful outcome
 * facts even when the page remains on the same URL and generation.
 */
function hasObservableEffect(evidence: TransitionEvidence | undefined): boolean {
  return evidence?.strength !== undefined && evidence.strength !== 'none';
}

const PROGRESS_AFTER_ERROR_CODES = new Set(['timeout', 'navigation_interrupted', 'element_detached']);

function hasProgressAfterError(result: V2ToolResult): boolean {
  const errorCode = result.error?.code;
  if (result.success || !errorCode) return false;
  if (!PROGRESS_AFTER_ERROR_CODES.has(errorCode)) {
    return false;
  }

  return result.evidence?.strength === 'moderate' || result.evidence?.strength === 'strong';
}

const PROGRESS_HISTORY_LIMIT = 8;
const READ_EVIDENCE_HISTORY_LIMIT = 8;
const REPEAT_SIGNAL_THRESHOLD = 2;
interface ActionProgressEntry {
  kind: string;
  targetKey: string;
  valueKey?: string;
  noProgressMutation: boolean;
  persistentFailure: boolean;
  actionSignature: string;
  semanticActionSignature?: string;
  semanticTargetKey?: string;
}

class ActionProgressMemory {
  private readonly entries: ActionProgressEntry[] = [];
  private readonly hardBlockedSignatures: Set<string> = new Set();
  private readonly hardBlockedSemanticSignatures: Set<string> = new Set();
  private readonly hardBlockedPersistentTargets: Set<string> = new Set();
  private readonly hardBlockedKinds: Set<string> = new Set();
  private readonly noProgressCountsByKind: Map<string, number> = new Map();
  private readonly persistentFailureCountsByTarget: Map<string, number> = new Map();

  static actionSignature(
    step: { tool: string; ref?: string; text?: string; value?: string; pattern?: string; url?: string; key?: string },
    targetOverride?: string,
  ): string {
    const tool = normalizeSignalToken(step.tool);
    const target = normalizeSignalToken(targetOverride ?? step.ref ?? 'global');
    const value = step.text ?? step.value ?? step.pattern ?? step.url ?? step.key;
    const valueKey = value ? normalizeProgressValue(value) : '__none__';
    return `${tool}:${target}:${valueKey}`;
  }

  isHardBlocked(
    step: { tool: string; ref?: string; text?: string; value?: string; pattern?: string; url?: string; key?: string },
    observation?: BrowserObservation,
  ): string | undefined {
    const sig = ActionProgressMemory.actionSignature(step);
    if (this.hardBlockedSignatures.has(sig)) return sig;

    const kind = normalizeSignalToken(step.tool);
    if (this.hardBlockedKinds.has(kind)) return `tool:${kind}`;

    if (observation && step.ref) {
      const ref = observation.refs.find(candidate => candidate.refId === step.ref);
      if (ref?.targetId) {
        const targetKey = normalizeSignalToken(ref.targetId);
        if (TARGET_MUTATION_KINDS.has(kind) && this.hardBlockedPersistentTargets.has(targetKey)) {
          return `persistent_target:${targetKey}`;
        }

        const semanticSig = ActionProgressMemory.actionSignature(step, ref.targetId);
        if (this.hardBlockedSemanticSignatures.has(semanticSig)) return semanticSig;
      }
    }

    return undefined;
  }

  resetSignatureOnPageChange(evidence: TransitionEvidence | undefined): void {
    if (!evidence) return;
    if (hasObservablePageChange(evidence)) {
      this.hardBlockedSignatures.clear();
      this.hardBlockedSemanticSignatures.clear();
      this.hardBlockedPersistentTargets.clear();
      this.hardBlockedKinds.clear();
      this.noProgressCountsByKind.clear();
      this.persistentFailureCountsByTarget.clear();
    }
  }

  record(result: V2ToolResult, plannedStep?: PlannerOutputStep, actionObservation?: BrowserObservation): string[] {
    const entry = progressEntryForResult(result, plannedStep, actionObservation);
    if (!entry) {
      return [];
    }

    this.entries.push(entry);
    if (this.entries.length > PROGRESS_HISTORY_LIMIT) {
      this.entries.shift();
    }

    const signals: string[] = [];

    if (entry.persistentFailure && entry.semanticTargetKey && TARGET_MUTATION_KINDS.has(entry.kind)) {
      const targetCount = (this.persistentFailureCountsByTarget.get(entry.semanticTargetKey) ?? 0) + 1;
      this.persistentFailureCountsByTarget.set(entry.semanticTargetKey, targetCount);
      if (targetCount >= REPEAT_SIGNAL_THRESHOLD) {
        signals.push(`repeated_persistent_target:${entry.semanticTargetKey}:${targetCount}`);
        this.hardBlockedPersistentTargets.add(entry.semanticTargetKey);
      }
    }

    if (entry.noProgressMutation) {
      if (!entry.persistentFailure) {
        const kindCount = (this.noProgressCountsByKind.get(entry.kind) ?? 0) + 1;
        this.noProgressCountsByKind.set(entry.kind, kindCount);
        if (kindCount >= REPEAT_SIGNAL_THRESHOLD) {
          signals.push(`repeated_no_progress_kind:${entry.kind}:${kindCount}`);
        }
        if (kindCount >= 3) {
          this.hardBlockedKinds.add(entry.kind);
        }
      }

      const count = this.entries.filter(existing =>
        existing.noProgressMutation
        && existing.kind === entry.kind
        && existing.targetKey === entry.targetKey,
      ).length;
      if (count >= REPEAT_SIGNAL_THRESHOLD) {
        signals.push(`repeated_no_progress_transition:${entry.kind}:${entry.targetKey}:${count}`);
      }
      if (count >= 3) {
        this.hardBlockedSignatures.add(entry.actionSignature);
      }

      const semanticCount = entry.semanticActionSignature
        ? this.entries.filter(existing =>
          existing.noProgressMutation
          && existing.semanticActionSignature === entry.semanticActionSignature,
        ).length
        : 0;
      if (semanticCount >= REPEAT_SIGNAL_THRESHOLD) {
        signals.push(`repeated_no_progress_target:${entry.semanticActionSignature}:${semanticCount}`);
      }
      if (semanticCount >= 3 && entry.semanticActionSignature) {
        this.hardBlockedSemanticSignatures.add(entry.semanticActionSignature);
      }
    }

    if (entry.valueKey) {
      const count = this.entries.filter(existing =>
        existing.kind === entry.kind
        && existing.targetKey === entry.targetKey
        && existing.valueKey === entry.valueKey,
      ).length;
      if (count >= REPEAT_SIGNAL_THRESHOLD) {
        signals.push(`repeated_value_preview:${entry.kind}:${entry.targetKey}:${count}`);
      }
      if (count >= 3) {
        this.hardBlockedSignatures.add(entry.actionSignature);
      }
    }

    return signals;
  }
}

function shouldRefreshAfterLowInformationAction(
  step: PlannerOutputStep,
  evidence: TransitionEvidence | undefined,
): boolean {
  if (evidence?.transitionClass !== 'microstate' || evidence.strength !== 'none') {
    return false;
  }

  // Clicks and key presses can open delayed overlays without producing a
  // structural transition in the first post-action capture. Keep this rule
  // tied to runtime evidence rather than a site or benchmark.
  return step.tool === 'click' || step.tool === 'press';
}

function isNoProgressMutation(result: V2ToolResult): boolean {
  if (!MUTATION_EVIDENCE_KINDS.has(result.kind) || result.kind === 'type' || result.kind === 'select') {
    return false;
  }

  // A mutation without transition evidence has no proof of progress. Track it
  // for bounded exact-action recovery, but never treat it as a state change.
  if (!result.evidence) {
    return true;
  }

  const evidence = result.evidence;
  if (evidence.urlChanged) {
    return false;
  }

  // Reloading the same URL without any observable ref change is not proof of
  // progress. Keep the loop guard active until the page exposes new state.
  if (result.kind === 'navigate' && !hasObservablePageChange(evidence)) {
    return true;
  }

  if (evidence.generationChanged) {
    return false;
  }

  if (evidence.strength === 'strong' || evidence.strength === 'negative') {
    return false;
  }

  if (previewResultValue(result.value)) {
    return false;
  }

  if (evidence.transitionClass === 'microstate' && evidence.strength === 'none') {
    return true;
  }

  if (evidence.transitionClass === 'structural_local') {
    return true;
  }

  return false;
}

function hasObservablePageChange(evidence: TransitionEvidence): boolean {
  return evidence.urlChanged
    || evidence.refChanges.appeared.length > 0
    || evidence.refChanges.disappeared.length > 0
    || evidence.refChanges.weakened.length > 0
    || evidence.notes.some(note => note.startsWith('ref_changed:') || note.startsWith('box_changed:'));
}

function hasPageBoundary(evidence: TransitionEvidence | undefined): boolean {
  return Boolean(evidence?.urlChanged || evidence?.generationChanged);
}

/**
 * Determines whether a tool result should be recorded in progress memory.
 * For read tools, we record a fallback placeholder "__empty__" when there is no text
 * retrieved, ensuring that repeated zero-content reads correctly trigger the loop detector.
 */
function progressEntryForResult(
  result: V2ToolResult,
  plannedStep?: PlannerOutputStep,
  actionObservation?: BrowserObservation,
): ActionProgressEntry | undefined {
  const persistentMutationFailure = !result.success
    && result.error?.retryable === false
    && MUTATION_EVIDENCE_KINDS.has(result.kind);
  if (!result.success && !persistentMutationFailure) {
    return undefined;
  }

  const kind = normalizeSignalToken(plannedStep?.tool ?? result.kind);
  const targetKey = normalizeSignalToken(plannedStep?.ref ?? result.targetRef ?? result.target?.refId ?? 'global');
  const noProgressMutation = persistentMutationFailure || isNoProgressMutation(result);
  const isRead = READ_TOOL_KINDS.has(result.kind);
  const valuePreview = isRead ? (previewResultValue(result.value) || '__empty__') : undefined;
  const mutationValue = plannedStep?.tool === 'type'
    ? plannedStep.text
    : plannedStep?.tool === 'select'
      ? plannedStep.value
      : undefined;
  const valueKey = valuePreview ?? (mutationValue ? normalizeProgressValue(mutationValue) : undefined);
  const semanticTargetId = plannedStep?.ref
    ? actionObservation?.refs.find(ref => ref.refId === plannedStep.ref)?.targetId
    : undefined;

  if (!noProgressMutation && valueKey === undefined) {
    return undefined;
  }

  return {
    kind,
    targetKey,
    valueKey,
    noProgressMutation,
    persistentFailure: persistentMutationFailure,
    actionSignature: plannedStep
      ? ActionProgressMemory.actionSignature(plannedStep)
      : `${kind}:${targetKey}:${valueKey ?? '__none__'}`,
    semanticActionSignature: plannedStep && semanticTargetId
      ? ActionProgressMemory.actionSignature(plannedStep, semanticTargetId)
      : undefined,
    semanticTargetKey: semanticTargetId ? normalizeSignalToken(semanticTargetId) : undefined,
  };
}


function normalizeSignalToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'unknown';
}

function normalizeProgressValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
}

function shouldContinueMiniPlan(input: {
  lastResult: V2ToolResult;
  nextStep: NonNullable<PlannerOutput['plan']>[number] | undefined;
  freshObservation: BrowserObservation;
}): boolean {
  if (!input.lastResult.success || !input.nextStep) {
    return false;
  }
  const nextStep = input.nextStep;

  if (input.lastResult.evidence?.urlChanged || input.lastResult.evidence?.generationChanged) {
    return false;
  }

  if (input.lastResult.evidence?.transitionClass === 'structural_macrostate') {
    return false;
  }

  if (
    nextStep.ref
    && !input.freshObservation.refs.some(ref => ref.refId === nextStep.ref && ref.state === 'live')
  ) {
    return false;
  }

  if (input.lastResult.kind === 'navigate') {
    return false;
  }

  if (
    input.lastResult.kind === 'click'
    && input.lastResult.evidence
    && input.lastResult.evidence.strength !== 'none'
  ) {
    return false;
  }

  if (
    input.lastResult.kind === 'press'
    && input.lastResult.evidence
    && input.lastResult.evidence.strength !== 'none'
  ) {
    return false;
  }

  // Break mini-plan after typing into combobox or searchbox — autocomplete needs re-observation
  if (
    input.lastResult.kind === 'type'
    && input.lastResult.target?.role
    && (input.lastResult.target.role === 'combobox' || input.lastResult.target.role === 'searchbox')
  ) {
    return false;
  }

  // Break mini-plan after typing into any field if new refs appeared (dropdown opened)
  if (
    input.lastResult.kind === 'type'
    && input.lastResult.evidence
    && input.lastResult.evidence.refChanges.appeared.length > 0
    && nextStep.tool !== 'press'
  ) {
    return false;
  }

  return input.lastResult.kind === 'type'
    || input.lastResult.kind === 'select'
    || input.lastResult.kind === 'get'
    || input.lastResult.kind === 'search_page'
    || input.lastResult.kind === 'inspect_region'
    || input.lastResult.kind === 'wait'
    || input.lastResult.kind === 'scroll';
}

function successfulToolEvidencePreview(result: V2ToolResult): string | undefined {
  if (!result.success) {
    return undefined;
  }

  if (READ_TOOL_KINDS.has(result.kind)) {
    return previewResultValue(result.value) ?? previewToolTarget(result.target);
  }

  if (
    MUTATION_EVIDENCE_KINDS.has(result.kind)
    && result.evidence
    && result.evidence.strength !== 'none'
    && result.evidence.strength !== 'negative'
  ) {
    return previewResultValue(result.value) ?? previewToolTarget(result.target);
  }

  return undefined;
}

function richResultEvidenceText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return compactRichEvidence(value);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['value', 'text', 'inputValue', 'url'] as const) {
    const part = record[key];
    if (typeof part === 'string' && part.trim()) {
      parts.push(part);
    }
  }

  if (Array.isArray(record.preview)) {
    parts.push(...record.preview.filter((part): part is string => typeof part === 'string' && part.trim().length > 0));
  }

  return parts.length > 0 ? compactRichEvidence(parts.join(' ')) : undefined;
}

function previewResultValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return compactResultPreview(value);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.inputValue === 'string' && record.inputValue.trim()) {
    return compactResultPreview(record.inputValue);
  }
  if (typeof record.url === 'string' && record.url.trim()) {
    return compactResultPreview(record.url);
  }
  if (typeof record.value === 'string' && record.value.trim()) {
    return compactResultPreview(record.value);
  }
  if (typeof record.text === 'string' && record.text.trim()) {
    return compactResultPreview(record.text);
  }
  if (Array.isArray(record.preview)) {
    const preview = record.preview.filter((item): item is string => typeof item === 'string').join(' ');
    return preview ? compactResultPreview(preview) : undefined;
  }
  return undefined;
}

function previewToolTarget(target: V2ToolResult['target']): string | undefined {
  if (!target) {
    return undefined;
  }

  const parts = [target.name, target.text, target.role]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  const uniqueParts = parts.filter((part, index) => parts.findIndex(existing => existing.toLowerCase() === part.toLowerCase()) === index);

  return uniqueParts.length > 0 ? compactResultPreview(uniqueParts.join(' ')) : undefined;
}

function compactResultPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function compactRichEvidence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 4_000);
}

export function validatePlannerStep(step: PlannerOutputStep): V2ToolError | undefined {
  if (step.tool === 'navigate' && step.url) {
    if (step.url.length > 2048) {
      return {
        code: 'invalid_action_payload',
        message: `URL too long (${step.url.length} chars, max 2048). Use a shorter URL or navigate via the page.`,
        retryable: true,
      };
    }
    try {
      new URL(step.url);
    } catch {
      return {
        code: 'invalid_action_payload',
        message: `Malformed URL: "${step.url.slice(0, 100)}...". Provide a valid URL.`,
        retryable: true,
      };
    }
  }
  return undefined;
}

export function normalizeAnswerValue(value: string, goal: string): string {
  // Only apply pronunciation normalization if the goal asks for pronunciation
  if (!/pronunc/i.test(goal)) return value;

  // If already labeled (contains UK/US or similar), return as-is
  if (/\b(UK|US|British|American)\b/i.test(value)) return value;

  // Match IPA patterns like /.../ separated by comma, semicolon, or newline
  const ipaPattern = /^(\/[^/]+\/)\s*[,;\n]\s*(\/[^/]+\/)$/;
  const match = value.trim().match(ipaPattern);
  if (match) {
    return `UK: ${match[1]} US: ${match[2]}`;
  }

  return value;
}
