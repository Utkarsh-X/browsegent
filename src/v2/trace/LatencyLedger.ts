export type LedgerPhase =
  | 'local_compute'
  | 'provider'
  | 'provider_pacing_wait'
  | 'browser_interaction'
  | 'stabilization_wait'
  | 'observation_capture';

export interface LedgerStep {
  stepIndex: number;
  phases: Partial<Record<LedgerPhase, number>>;
  totalMs: number;
}

export interface LedgerSummary {
  stepCount: number;
  steps: LedgerStep[];
  totals: Record<LedgerPhase | 'unaccounted' | 'total', number>;
}

const ALL_PHASES: LedgerPhase[] = [
  'local_compute', 'provider', 'provider_pacing_wait', 'browser_interaction',
  'stabilization_wait', 'observation_capture',
];

export class LatencyLedger {
  private steps: LedgerStep[] = [];
  private currentStep: LedgerStep | undefined;
  private currentStepStartedAt: number | undefined;

  beginStep(stepIndex: number): void {
    if (this.currentStep) {
      throw new Error(`Cannot begin latency step ${stepIndex}: active latency step ${this.currentStep.stepIndex} must be ended first`);
    }
    this.currentStep = { stepIndex, phases: {}, totalMs: 0 };
    this.currentStepStartedAt = Date.now();
  }

  recordPhase(phase: LedgerPhase, durationMs: number): void {
    if (!this.currentStep) return;
    this.currentStep.phases[phase] = (this.currentStep.phases[phase] ?? 0) + durationMs;
  }

  endStep(stepIndex: number, totalMs: number): void {
    if (!this.currentStep || this.currentStep.stepIndex !== stepIndex) return;
    this.currentStep.totalMs = totalMs;
    this.steps.push(this.currentStep);
    this.currentStep = undefined;
    this.currentStepStartedAt = undefined;
  }

  /** Close any active step using elapsed wall time. Call before early returns. */
  closeActiveStep(): void {
    if (!this.currentStep) return;
    this.currentStep.totalMs = this.currentStepStartedAt
      ? Date.now() - this.currentStepStartedAt
      : 0;
    this.steps.push(this.currentStep);
    this.currentStep = undefined;
    this.currentStepStartedAt = undefined;
  }

  summarize(): LedgerSummary {
    const totals: Record<string, number> = {};
    for (const p of ALL_PHASES) totals[p] = 0;
    totals.unaccounted = 0;
    totals.total = 0;

    for (const step of this.steps) {
      let stepAccounted = 0;
      for (const phase of ALL_PHASES) {
        const ms = step.phases[phase] ?? 0;
        totals[phase] += ms;
        stepAccounted += ms;
      }
      totals.unaccounted += Math.max(0, step.totalMs - stepAccounted);
      totals.total += step.totalMs;
    }

    return { stepCount: this.steps.length, steps: this.steps, totals } as LedgerSummary;
  }

  toJSON(): unknown { return this.summarize(); }
}
